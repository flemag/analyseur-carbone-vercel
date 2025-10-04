import cheerio from 'cheerio';

// Helper pour faire des requêtes fetch avec timeout
const fetchWithTimeout = (url, options = {}, timeout = 5000) => {
    return Promise.race([
        fetch(url, options),
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Timeout')), timeout)
        )
    ]);
};

// Helper pour obtenir la taille d'une ressource
async function getResourceSize(url) {
    try {
        const res = await fetchWithTimeout(url, { method: 'HEAD' });
        const contentLength = res.headers.get('content-length');
        return contentLength ? parseInt(contentLength, 10) : 0;
    } catch (error) {
        // console.error(`Impossible de récupérer la taille pour ${url}:`, error.message);
        return 0;
    }
}

// Tableau d'intensité carbone du réseau (gCO2/kWh) - source: AIE / moyenne mondiale
const gridIntensity = {
    'FR': 52, 'DE': 401, 'GB': 208, 'US': 384, 'CA': 129, 'AU': 635,
    'GLOBAL': 475 // Valeur par défaut
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
        const siteResponse = await fetchWithTimeout(url);
        if (!siteResponse.ok) throw new Error('Site inaccessible');
        const html = await siteResponse.text();
        const $ = cheerio.load(html);

        // 2. Analyser les ressources
        const resources = {
            images: [],
            scripts: [],
            css: [],
            other: []
        };

        $('img[src]').each((i, el) => resources.images.push(new URL($(el).attr('src'), url).href));
        $('link[rel="stylesheet"]').each((i, el) => resources.css.push(new URL($(el).attr('href'), url).href));
        $('script[src]').each((i, el) => resources.scripts.push(new URL($(el).attr('src'), url).href));

        const allResourceUrls = [...resources.images, ...resources.scripts, ...resources.css];

        // 3. Calculer le poids total
        let totalBytes = 0;
        const breakdown = { images: 0, scripts: 0, css: 0, other: 0 };

        for (const resourceUrl of allResourceUrls) {
            const size = await getResourceSize(resourceUrl);
            totalBytes += size;
            if (resources.images.includes(resourceUrl)) breakdown.images += size;
            else if (resources.scripts.includes(resourceUrl)) breakdown.scripts += size;
            else if (resources.css.includes(resourceUrl)) breakdown.css += size;
        }
        
        // Ajouter le poids de la page HTML elle-même
        const htmlSize = new Blob([html]).size;
        totalBytes += htmlSize;
        breakdown.other += htmlSize;

        const totalDataMB = totalBytes / (1024 * 1024);
        const totalDataGB = totalDataMB / 1024;

        // 4. Obtenir les infos d'hébergement
        let hostingInfo = { provider: 'Inconnu', country: 'Inconnu', isGreen: false };
        try {
            const { hostname } = new URL(url);
            const ipResponse = await fetchWithTimeout(`http://ip-api.com/json/${hostname}`);
            const ipData = await ipResponse.json();
            if (ipData.status === 'success') {
                hostingInfo.provider = ipData.org || ipData.isp;
                hostingInfo.country = ipData.countryCode;
            }

            // 5. Vérifier l'hébergement vert
            const greenResponse = await fetchWithTimeout(`https://api.thegreenwebfoundation.org/v2/greencheck/${hostname}`);
            const greenData = await greenResponse.json();
            hostingInfo.isGreen = greenData.green;
        } catch (error) {
            console.error("Erreur lors de la récupération des infos d'hébergement:", error.message);
        }

        // 6. Calculer l'empreinte carbone
        const intensity = gridIntensity[hostingInfo.country] || gridIntensity.GLOBAL;
        const energyPerGB = 1.8; // kWh/Go
        const co2Grams = totalDataGB * energyPerGB * intensity;

        // 7. Générer les recommandations
        const recommendations = [];
        if (breakdown.images / totalBytes > 0.6) {
            recommendations.push("🖼️ Vos images sont très lourdes. Passez-les au format WebP et compressez-les pour un gain de performance et d'énergie significatif.");
        }
        if (breakdown.scripts / totalBytes > 0.3) {
            recommendations.push("📜 Les scripts JavaScript représentent une part importante du poids. Assurez-vous de ne charger que les scripts nécessaires sur cette page.");
        }
        if (!hostingInfo.isGreen) {
            recommendations.push("🌱 Votre hébergeur n'est pas répertorié comme vert. Choisir un fournisseur d'énergie renouvelable est l'action la plus impactante pour réduire votre empreinte.");
        }
        if (recommendations.length === 0) {
            recommendations.push("✅ Excellent ! Votre site semble déjà bien optimisé. Continuez comme ça !");
        }

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
        console.error('Erreur dans la fonction d\'analyse:', error);
        res.status(500).json({ message: 'Erreur interne du serveur', error: error.message });
    }
}