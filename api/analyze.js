const cheerio = require('cheerio');

const fetchWithTimeout = (url, options = {}, timeout = 8000) => {
    const defaultOptions = {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36' },
        ...options,
    };
    return Promise.race([fetch(url, defaultOptions), new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), timeout))]);
};

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ message: 'Méthode non autorisée' });
    const { url, monthlyVisits = 10000 } = req.body; // Récupérer les visites
    if (!url) return res.status(400).json({ message: 'URL manquante' });

    let html;
    try {
        const siteResponse = await fetchWithTimeout(url);
        if (!siteResponse.ok) throw new Error(`Statut HTTP: ${siteResponse.status}`);
        html = await siteResponse.text();
    } catch (error) {
        console.error(`Échec de la récupération du site ${url}:`, error.message);
        const message = error.message.includes('redirect count exceeded') ? `Le site ${url} effectue trop de redirections ou bloque les requêtes automatiques.` : `Impossible d'accéder au site ${url}.`;
        return res.status(500).json({ message });
    }

    if (!html || typeof html !== 'string' || html.trim().length === 0) {
        return res.status(500).json({ message: `Le site ${url} a renvoyé une page vide.` });
    }

    try {
        const $ = cheerio.load(html);
        const originalHostname = new URL(url).hostname;
        let totalBytes = new Blob([html]).size;
        const breakdown = { images: 0, scripts: 0, css: 0, other: totalBytes };
        const thirdPartyDomains = new Set();
        let thirdPartyBytes = 0;

        const resourceUrls = new Set();
        $('img[src]').each((i, el) => resourceUrls.add(new URL($(el).attr('src'), url).href));
        $('link[rel="stylesheet"]').each((i, el) => resourceUrls.add(new URL($(el).attr('href'), url).href));
        $('script[src]').each((i, el) => resourceUrls.add(new URL($(el).attr('src'), url).href));

        for (const resourceUrl of resourceUrls) {
            try {
                const size = await getResourceSize(resourceUrl);
                totalBytes += size;
                const resourceHostname = new URL(resourceUrl).hostname;

                if (resourceHostname !== originalHostname) {
                    thirdPartyDomains.add(resourceHostname);
                    thirdPartyBytes += size;
                }

                if (resourceUrl.match(/\.(jpg|jpeg|png|gif|webp|svg)$/i)) breakdown.images += size;
                else if (resourceUrl.match(/\.js$/i)) breakdown.scripts += size;
                else if (resourceUrl.match(/\.css$/i)) breakdown.css += size;
                else breakdown.other += size;
            } catch (error) { /* Ignorer les erreurs de ressource */ }
        }

        const totalDataMB = totalBytes / (1024 * 1024);
        const totalDataGB = totalDataMB / 1024;

        // --- NOUVEAUX CALCULS ---
        const gridIntensity = { 'FR': 52, 'DE': 401, 'GB': 208, 'US': 384, 'CA': 125, 'GLOBAL': 475 };
        
        // Hébergement
        let hostingInfo = { provider: 'Inconnu', country: 'Inconnu', isGreen: false };
        try {
            const { hostname } = new URL(url);
            const ipResponse = await fetchWithTimeout(`http://ip-api.com/json/${hostname}`);
            const ipData = await ipResponse.json();
            if (ipData.status === 'success') {
                hostingInfo.provider = ipData.org || ipData.isp;
                hostingInfo.country = ipData.countryCode;
            }
        } catch (error) { /* Ignorer */ }

        try {
            const { hostname } = new URL(url);
            const greenResponse = await fetchWithTimeout(`https://api.thegreenwebfoundation.org/v2/greencheck/${hostname}`);
            const greenData = await greenResponse.json();
            hostingInfo.isGreen = greenData.green;
        } catch (error) { /* Ignorer */ }

        // Calculs environnementaux
        const intensity = gridIntensity[hostingInfo.country] || gridIntensity.GLOBAL;
        const energyPerGB = 1.8; // kWh/Go
        const co2Grams = totalDataGB * energyPerGB * intensity;
        const annualCo2Kg = (co2Grams / 1000) * monthlyVisits * 12;
        
        // Estimation de la consommation d'eau (source: ~1.5L par Mo de transfert)
        const waterLiters = totalDataMB * 1.5 * monthlyVisits * 12;

        // Calcul du percentile (estimation basée sur des études)
        let percentile = 50;
        if (co2Grams < 0.5) percentile = 90;
        else if (co2Grams < 1.0) percentile = 70;
        else if (co2Grams < 2.0) percentile = 40;
        else percentile = 20;

        // Recommandations enrichies
        const recommendations = [];
        if (breakdown.images / totalBytes > 0.6) recommendations.push("🖼️ Vos images sont très lourdes. Passez-les au format WebP et compressez-les.");
        if (breakdown.scripts / totalBytes > 0.3) recommendations.push("📜 Les scripts JavaScript sont lourds. Assurez-vous de ne charger que le nécessaire.");
        if (!hostingInfo.isGreen) {
            recommendations.push("🌱 Votre hébergeur n'est pas répertorié comme vert. Changer pour un hébergeur vert est l'action la plus impactante. Envisagez des fournisseurs comme Infomaniak (Suisse) ou Scaleway (France).");
        }
        if (thirdPartyBytes / totalBytes > 0.3) {
            recommendations.push("🔗 Les ressources tierces (publicité, analytics) représentent une part importante du poids. Auditez-les pour supprimer celles qui ne sont pas essentielles.");
        }
        if (recommendations.length === 0) recommendations.push("✅ Excellent ! Votre site semble bien optimisé.");

        const reportData = {
            co2Grams, totalDataMB, breakdown, hosting, recommendations,
            percentile, waterLiters, annualCo2Kg,
            thirdParty: {
                weightMB: thirdPartyBytes / (1024 * 1024),
                domains: Array.from(thirdPartyDomains)
            }
        };

        res.status(200).json(reportData);

    } catch (finalError) {
        console.error('Erreur critique lors du traitement:', finalError);
        res.status(500).json({ message: 'Une erreur inattendue est survenue.', details: finalError.message });
    }
}

async function getResourceSize(url) {
    try {
        const res = await fetchWithTimeout(url, { method: 'HEAD' });
        return parseInt(res.headers.get('content-length'), 10) || 0;
    } catch (error) {
        return 0;
    }
}