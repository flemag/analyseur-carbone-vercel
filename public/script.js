document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('url-form');
    const input = document.getElementById('url-input');
    const resultsContainer = document.getElementById('results');
    const loadingContainer = document.getElementById('loading');

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const url = input.value;

        if (!url) return;

        // Afficher le chargement
        resultsContainer.classList.add('hidden');
        loadingContainer.classList.remove('hidden');

        try {
            const response = await fetch('/api/analyze', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ url }),
            });

            if (!response.ok) {
                throw new Error(`Erreur HTTP! statut: ${response.status}`);
            }

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
        const { co2Grams, totalDataMB, breakdown, hosting, recommendations } = data;
        const isClean = co2Grams < 0.5;

        resultsContainer.innerHTML = `
            <div class="report-card">
                <h2>🌍 Score Global</h2>
                <div class="score-display ${isClean ? '' : 'danger'}">${co2Grams.toFixed(2)} g de CO₂ / visite</div>
                <p style="text-align: center;">${isClean ? 'Plus propre que la moyenne des sites web.' : 'Plus polluant que la moyenne.'}</p>
            </div>

            <div class="report-card">
                <h2>📊 Détail de l'Impact</h2>
                <p><strong>Poids total de la page :</strong> ${totalDataMB.toFixed(2)} Mo</p>
                <div class="detail-grid">
                    <div class="detail-item">🖼️ <strong>Images:</strong> ${breakdown.images.toFixed(2)} Mo</div>
                    <div class="detail-item">📜 <strong>Scripts:</strong> ${breakdown.scripts.toFixed(2)} Mo</div>
                    <div class="detail-item">🎨 <strong>CSS & Polices:</strong> ${breakdown.css.toFixed(2)} Mo</div>
                    <div class="detail-item">📄 <strong>Autres:</strong> ${breakdown.other.toFixed(2)} Mo</div>
                </div>
            </div>

            <div class="report-card">
                <h2>🏢 Infrastructure d'Hébergement</h2>
                <div class="detail-grid">
                    <div class="detail-item"><strong>Fournisseur :</strong> ${hosting.provider || 'Inconnu'}</div>
                    <div class="detail-item"><strong>Pays :</strong> ${hosting.country || 'Inconnu'}</div>
                </div>
                <p style="margin-top: 1rem;">
                    <strong>Énergie Verte :</strong> 
                    ${hosting.isGreen ? '✅ Oui (Source: The Green Web Foundation)' : '❌ Non ou Inconnu'}
                </p>
            </div>

            <div class="report-card recommendations">
                <h2>🚀 Recommandations</h2>
                <ul>
                    ${recommendations.map(rec => `<li>${rec}</li>`).join('')}
                </ul>
            </div>
        `;
        resultsContainer.classList.remove('hidden');
    }
});