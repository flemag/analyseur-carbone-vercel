import cheerio from 'cheerio';

// Helper pour faire des requêtes fetch avec timeout et un User-Agent
const fetchWithTimeout = (url, options = {}, timeout = 8000) => {
    const defaultOptions = {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36',
        },
        ...options,
    };
    return Promise.race([
        fetch(url, defaultOptions),
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Timeout')), timeout)
        )
    ]);
};

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Méthode non autorisée' });
    }

    const { url } = req.body;
    if (!url) {
        return res.status(400).json({ message: 'URL manquante' });
    }

    try {
        // 1. Récupérer le contenu HTML de la page
        let html;
        try {
            const siteResponse = await fetchWithTimeout(url);
            if (!siteResponse.ok) throw new Error(`Statut HTTP: ${siteResponse.status}`);
            html = await siteResponse.text();
        } catch (error) {
            console.error(`Échec de la récupération du site ${url}:`, error.message);
            // Message d'erreur plus spécifique pour les redirections
            const message = error.message.includes('redirect count exceeded')
                ? `Le site ${url} effectue trop de redirections ou bloque les requêtes automatiques. Essayez avec un autre site.`
                : `Impossible d'accéder au site ${url}. Il est peut-être inaccessible ou bloque les requêtes automatiques.`;
            return res.status(500).json({ message });
        }

        // Si le HTML est vide, on arrête
        if (!html) {
            return res.status(500).json({ message: `Le site ${url} a renvoyé une page vide.` });
        }

        const $ = cheerio.load(html);
        let totalBytes = new Blob([html]).size;
        const breakdown = { images: 0, scripts: 0, css: 0, other: totalBytes };

        const resourceUrls = new Set();
        $('img[src]').each((i, el) => resourceUrls.add(new URL($(el).attr('src'), url).href));
        $('link[rel="stylesheet"]').each((i, el) => resourceUrls.add(new URL($(el).attr('href'), url).href));
        $('script[src]').each((i, el) => resourceUrls.add(new URL($(el).attr('src'), url).href));

        // 2. Calculer le poids des ressources
        for (const resourceUrl of resourceUrls) {
            try {
                const size = await getResourceSize(resourceUrl);
                totalBytes += size;
                if (resourceUrl.match(/\.(jpg|jpeg|png|gif|webp|svg)$/i)) breakdown.images += size;
                else if (resourceUrl.match(/\.js$/i)) breakdown.scripts += size;
                else if (resourceUrl.match(/\.css$/i)) breakdown.css += size;
                else breakdown.other += size;
            } catch (error) {
                console.warn(`Impossible de mesurer la ressource ${resourceUrl}: ${error.message}`);
            }
        }

        const totalDataMB = totalBytes / (1024 * 1024);
        const totalDataGB = totalDataMB / 1024;

        // 3. Obtenir les infos d'hébergement
        let hostingInfo = { provider: 'Inconnu', country: 'Inconnu', isGreen: false };
        try {
            const { hostname } = new URL(url);
            const ipResponse = await fetchWithTimeout(`http://ip-api.com/json/${hostname}`);
            const ipData = await ipResponse.json();
            if (ipData.status === 'success') {
                hostingInfo.provider = ipData.org || ipData.isp;
                hostingInfo.country = ipData.countryCode;
            }
        } catch (error) {
            console.warn(`Erreur ip-api.com: ${error.message}`);
        }

        // 4. Vérifier l'hébergement vert
        try {
            const { hostname } = new URL(url);
            const greenResponse = await fetchWithTimeout(`https://api.thegreenwebfoundation.org/v2/greencheck/${hostname}`);
            const greenData = await greenResponse.json();
            hostingInfo.isGreen = greenData.green;
        } catch (error) {
            console.warn(`Erreur The Green Web Foundation: ${error.message}`);
        }

        // 5. Calculer l'empreinte carbone
        const gridIntensity = { 'FR': 52, 'DE': 401, 'GB': 208, 'US': 384, 'GLOBAL': 475 };
        const intensity = gridIntensity[hostingInfo.country] || gridIntensity.GLOBAL;
        const energyPerGB = 1.8; // kWh/Go
        const co2Grams = totalDataGB * energyPerGB * intensity;

        // 6. Générer les recommandations
        const recommendations = [];
        if (breakdown.images / totalBytes > 0.6) recommendations.push("🖼️ Vos images sont très lourdes. Passez-les au format WebP et compressez-les.");
        if (breakdown.scripts / totalBytes > 0.3) recommendations.push("📜 Les scripts JavaScript sont lourds. Assurez-vous de ne charger que le nécessaire.");
        if (!hostingInfo.isGreen) recommendations.push("🌱 Votre hébergeur n'est pas répertorié comme vert. Changer pour un hébergeur vert est l'action la plus impactante.");
        if (recommendations.length === 0) recommendations.push("✅ Excellent ! Votre site semble bien optimisé.");

        const reportData = {
            co2Grams,
            totalDataMB,
            breakdown: {
                images: breakdown.images / (1024 * 1024),
                scripts: breakdown.scripts / (1024 * 1024),
                css: breakdown.css / (1024 * 1024),
                other: breakdown.other / (1024 * 1024),
            },
            hosting: hostingInfo,
            recommendations
        };

        res.status(200).json(reportData);

    } catch (error) {
        console.error('Erreur critique dans la fonction d\'analyse:', error);
        res.status(500).json({ message: 'Une erreur interne inattendue est survenue.', details: error.message });
    }
}

// Helper pour obtenir la taille d'une ressource
async function getResourceSize(url) {
    try {
        const res = await fetchWithTimeout(url, { method: 'HEAD' });
        const contentLength = res.headers.get('content-length');
        return contentLength ? parseInt(contentLength, 10) : 0;
    } catch (error) {
        return 0;
    }
}