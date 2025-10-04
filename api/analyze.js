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
    console.log("--- DÉBUT DE LA FONCTION ---");
    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Méthode non autorisée' });
    }

    const { url } = req.body;
    console.log(`URL reçue: ${url}`);
    if (!url) {
        return res.status(400).json({ message: 'URL manquante' });
    }

    let html;
    try {
        console.log("Tentative de récupération du HTML...");
        const siteResponse = await fetchWithTimeout(url);
        console.log(`Réponse reçue, statut: ${siteResponse.status}`);
        if (!siteResponse.ok) throw new Error(`Statut HTTP: ${siteResponse.status}`);
        
        html = await siteResponse.text();
        console.log(`HTML récupéré. Type: ${typeof html}, Longueur: ${html ? html.length : 'N/A'}`);
        console.log(`Début du HTML: ${html ? html.substring(0, 100) : 'N/A'}`);

    } catch (error) {
        console.error(`Échec de la récupération du site ${url}:`, error.message);
        const message = error.message.includes('redirect count exceeded')
            ? `Le site ${url} effectue trop de redirections ou bloque les requêtes automatiques.`
            : `Impossible d'accéder au site ${url}. Il est peut-être inaccessible ou bloque les requêtes automatiques.`;
        return res.status(500).json({ message });
    }

    // *** VÉRIFICATION AVEC LOGS ***
    console.log("Vérification de la validité du HTML...");
    if (!html) {
        console.log("ERREUR : La variable 'html' est falsy (null, undefined, false, 0, '').");
        return res.status(500).json({ message: `Le site ${url} a renvoyé une réponse vide.` });
    }
    if (typeof html !== 'string') {
        console.log(`ERREUR : La variable 'html' n'est pas une string, son type est ${typeof html}.`);
        return res.status(500).json({ message: `Le site ${url} a renvoyé une réponse invalide.` });
    }
    if (html.trim().length === 0) {
        console.log("ERREUR : La variable 'html' est une string vide.");
        return res.status(500).json({ message: `Le site ${url} a renvoyé une page blanche.` });
    }
    console.log("Le HTML semble valide. Continuation...");


    // On met tout le reste dans un try...catch final pour isoler le problème
    try {
        console.log("Tentative de charger le HTML avec Cheerio...");
        const $ = cheerio.load(html);
        console.log("Cheerio a chargé le HTML avec succès.");

        let totalBytes = new Blob([html]).size;
        const breakdown = { images: 0, scripts: 0, css: 0, other: totalBytes };

        const resourceUrls = new Set();
        $('img[src]').each((i, el) => resourceUrls.add(new URL($(el).attr('src'), url).href));
        $('link[rel="stylesheet"]').each((i, el) => resourceUrls.add(new URL($(el).attr('href'), url).href));
        $('script[src]').each((i, el) => resourceUrls.add(new URL($(el).attr('src'), url).href));

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

        try {
            const { hostname } = new URL(url);
            const greenResponse = await fetchWithTimeout(`https://api.thegreenwebfoundation.org/v2/greencheck/${hostname}`);
            const greenData = await greenResponse.json();
            hostingInfo.isGreen = greenData.green;
        } catch (error) {
            console.warn(`Erreur The Green Web Foundation: ${error.message}`);
        }

        const gridIntensity = { 'FR': 52, 'DE': 401, 'GB': 208, 'US': 384, 'GLOBAL': 475 };
        const intensity = gridIntensity[hostingInfo.country] || gridIntensity.GLOBAL;
        const energyPerGB = 1.8;
        const co2Grams = totalDataGB * energyPerGB * intensity;

        const recommendations = [];
        if (breakdown.images / totalBytes > 0.6) recommendations.push("🖼️ Vos images sont très lourdes. Passez-les au format WebP et compressez-les.");
        if (breakdown.scripts / totalBytes > 0.3) recommendations.push("📜 Les scripts JavaScript sont lourds. Assurez-vous de ne charger que le nécessaire.");
        if (!hostingInfo.isGreen) recommendations.push("🌱 Votre hébergeur n'est pas répertorié comme vert. Changer pour un hébergeur vert est l'action la plus impactante.");
        if (recommendations.length === 0) recommendations.push("✅ Excellent ! Votre site semble bien optimisé.");

        const reportData = { co2Grams, totalDataMB, breakdown: { images: breakdown.images / (1024 * 1024), scripts: breakdown.scripts / (1024 * 1024), css: breakdown.css / (1024 * 1024), other: breakdown.other / (1024 * 1024) }, hosting: hostingInfo, recommendations };
        console.log("--- SUCCÈS DE LA FONCTION ---");
        res.status(200).json(reportData);

    } catch (finalError) {
        console.error('ERREUR CRITIQUE DANS LE BLOC FINAL:', finalError);
        res.status(500).json({ message: 'Une erreur inattendue est survenue lors du traitement.', details: finalError.message });
    }
}

async function getResourceSize(url) {
    try {
        const res = await fetchWithTimeout(url, { method: 'HEAD' });
        const contentLength = res.headers.get('content-length');
        return contentLength ? parseInt(contentLength, 10) : 0;
    } catch (error) {
        return 0;
    }
}