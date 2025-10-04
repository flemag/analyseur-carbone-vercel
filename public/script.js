document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('url-form');
    const urlInput = document.getElementById('url-input');
    const visitsInput = document.getElementById('visits-input');
    const resultsContainer = document.getElementById('results');
    const loadingContainer = document.getElementById('loading');

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const url = urlInput.value;
        const monthlyVisits = parseInt(visitsInput.value, 10) || 10000; // Valeur par défaut

        if (!url) return;

        resultsContainer.classList.add('hidden');
        loadingContainer.classList.remove('hidden');

        try {
            const response = await fetch('/api/analyze', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url, monthlyVisits }),
            });

            if (!response.ok) throw new Error(`Erreur HTTP! statut: ${response.status}`);
            const data = await response.json();
            renderReport(data);

        } catch (error) {
            console.error('Erreur lors de l\'analyse:', error);
            resultsContainer.innerHTML = `<div class="report-card"><h2>Erreur</h2><p>Impossible d'analyser le site. Vérifiez l'URL et réessayez.</p></div>`;
            resultsContainer.classList.remove('hidden');
        } finally {
            loadingContainer.classList.add('hidden');
        }
    });

    function renderReport(data) {
        const { co2Grams, totalDataMB, breakdown, hosting, recommendations, percentile, waterLiters, annualCo2Kg, thirdParty } = data;
        const isClean = co2Grams < 0.5;

        resultsContainer.innerHTML = `
            <div class="report-card">
                <h2>🌍 Score Global</h2>
                <div class="score-display ${isClean ? '' : 'danger'}">${co2Grams.toFixed(2)} g de CO₂ / visite</div>
                <p style="text-align: center;">Ce site est plus propre que <strong>${percentile}%</strong> des sites web analysés.</p>
                <p style="text-align: center; font-size: 0.9rem; color: var(--light-text-color);">Équivaut à faire chauffer une bouilloire pour ${co2Grams > 1 ? Math.round(co2Grams) : 1} tasse(s) de thé.</p>
            </div>

            <div class="report-card">
                <h2>📊 Analyse Détaillée de la Page</h2>
                
                <div class="metric-card">
                    <h3>Performance Estimée</h3>
                    <p>${totalDataMB < 1 ? '⚡ Rapide' : totalDataMB < 3 ? '🐌 Modérée' : '🐢 Lente'} (Basée sur le poids de ${totalDataMB.toFixed(2)} Mo)</p>
                </div>

                <h4 style="margin-top: 1.5rem;">Répartition du Poids</h4>
                ${renderChart(breakdown.images, 'Images', totalDataMB)}
                ${renderChart(breakdown.scripts, 'Scripts', totalDataMB)}
                ${renderChart(breakdown.css, 'CSS & Polices', totalDataMB)}
                ${renderChart(breakdown.other, 'Autres', totalDataMB)}

                ${thirdParty.weightMB > 0 ? `
                    <h4 style="margin-top: 1.5rem;">🔗 Ressources Tiers (${thirdParty.weightMB.toFixed(2)} Mo)</h4>
                    <p style="font-size: 0.9rem;">Ces services externes (publicité, analytics...) impactent le poids et la vie privée.</p>
                    <ul style="font-size: 0.9rem; list-style-type: '👉 '; padding-left: 1rem;">
                        ${thirdParty.domains.map(domain => `<li>${domain}</li>`).join('')}
                    </ul>
                ` : ''}
            </div>

            <div class="report-card">
                <h2>🌍 Impact Environnemental & Infrastructure</h2>
                <div class="detail-grid">
                    <div class="detail-item"><strong>Fournisseur :</strong> ${hosting.provider || 'Inconnu'}</div>
                    <div class="detail-item"><strong>Pays :</strong> ${hosting.country || 'Inconnu'}</div>
                </div>
                <p style="margin-top: 1rem;"><strong>Énergie Verte :</strong> ${hosting.isGreen ? '✅ Oui' : '❌ Non ou Inconnu'}</p>
                
                <div class="metric-card" style="margin-top: 1.5rem;">
                    <h3>Impact Annuel Estimé (pour ${monthlyVisits.toLocaleString()} visites/mois)</h3>
                    <p><strong>${annualCo2Kg.toFixed(2)} kg de CO₂</strong> émis par an.</p>
                    <p>Soit l'équivalent de ${Math.round(annualCo2Kg / 20)} km parcourus en voiture.</p>
                </div>

                <div class="metric-card">
                    <h3>Consommation d'Eau des Data Centers</h3>
                    <p>Environ <strong>${waterLiters.toFixed(0)} litres d'eau</strong> consommés par an pour les transferts de données.</p>
                </div>
            </div>

            <div class="report-card recommendations">
                <h2>🚀 Plan d'Action Personnalisé</h2>
                <ul>
                    ${recommendations.map(rec => `<li>${rec}</li>`).join('')}
                </ul>
            </div>
        `;
        resultsContainer.classList.remove('hidden');
    }
    
    // Fonction helper pour créer un graphique à barres simple
    function renderChart(valueMB, label, totalMB) {
        const percentage = totalMB > 0 ? (valueMB / totalMB) * 100 : 0;
        return `
            <div style="margin-bottom: 0.5rem;">
                <div style="display: flex; justify-content: space-between;">
                    <span>${label}</span>
                    <span>${valueMB.toFixed(2)} Mo</span>
                </div>
                <div class="chart-bar">
                    <div class="chart-fill" style="width: ${percentage}%;"></div>
                </div>
            </div>
        `;
    }
});