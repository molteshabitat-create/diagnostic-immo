import React, { useState, useEffect } from 'react';
import jsPDF from 'jspdf';

// Redimensionne et compresse une image côté navigateur avant envoi.
// Évite les payloads trop lourds qui font planter les fonctions serverless en local.
function compressImage(file, maxWidth = 1600, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();

    reader.onload = (e) => {
      img.onload = () => {
        const scale = Math.min(1, maxWidth / img.width);
        const canvas = document.createElement('canvas');
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;

        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(new Error('Compression échouée'));
              return;
            }
            const compressedReader = new FileReader();
            compressedReader.onload = () => resolve(compressedReader.result.split(',')[1]);
            compressedReader.onerror = reject;
            compressedReader.readAsDataURL(blob);
          },
          'image/jpeg',
          quality
        );
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Conversion simple en base64, sans compression (utilisée pour les PDF, non compressibles via canvas)
function fileToBase64Raw(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function reliabilityClass(value) {
  if (value === 'Élevée') return 'high';
  if (value === 'Moyenne') return 'medium';
  if (value === 'Faible') return 'low';
  return 'medium';
}

function ScanDiagram() {
  return (
    <div className="scan-diagram">
      <div className="scan-house">
        <svg viewBox="0 0 200 150" fill="none">
          <rect x="0" y="0" width="200" height="150" fill="#EEF2F6" />
          <polygon points="20,80 100,25 180,80" stroke="#2F5C8A" strokeWidth="2" fill="none" />
          <rect x="30" y="80" width="140" height="55" stroke="#2F5C8A" strokeWidth="2" fill="none" />
          <rect x="45" y="95" width="22" height="22" stroke="#7C96AC" strokeWidth="1.5" fill="none" />
          <rect x="133" y="95" width="22" height="22" stroke="#7C96AC" strokeWidth="1.5" fill="none" />
          <rect x="90" y="100" width="20" height="35" stroke="#7C96AC" strokeWidth="1.5" fill="none" />
        </svg>
        <div className="scan-line" aria-hidden="true" />
      </div>
      <div className="scan-callouts">
        <div className="callout">TOITURE — isolation probable faible, à confirmer</div>
        <div className="callout">CHAUFFAGE — cohérent avec la surface déclarée</div>
        <div className="callout">FENÊTRES — double vitrage probable, bon état apparent</div>
      </div>
    </div>
  );
}

export default function App() {
  const [photoRightsConfirmed, setPhotoRightsConfirmed] = useState(false);
  const [dpeFile, setDpeFile] = useState(null);
  const [photos, setPhotos] = useState([]);
  const [form, setForm] = useState({
    periode_construction: '',
    annee_exacte: '',
    renovation_recente: false,
    surface: '',
    type_bien: '',
    localisation: '',
    chauffage: '',
    dpe: '',
    annonce: ''
  });
  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState(0);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const handlePhotoChange = (e) => {
    const files = Array.from(e.target.files).slice(0, 10);
    setPhotos(files);
  };

  const handleFormChange = (e) => {
    const { name, type, value, checked } = e.target;
    setForm({ ...form, [name]: type === 'checkbox' ? checked : value });
  };

  const loadingMessages = [
    "J'analyse vos photos…",
    "Calcul de l'isolation et du chauffage en cours…",
    "Je rédige votre rapport…"
  ];

  useEffect(() => {
    if (!loading) {
      setLoadingStep(0);
      return;
    }
    const interval = setInterval(() => {
      setLoadingStep((prev) => (prev < loadingMessages.length - 1 ? prev + 1 : prev));
    }, 3500);
    return () => clearInterval(interval);
  }, [loading]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setResult(null);

    if (photos.length === 0) {
      setError('Ajoute au moins une photo du bien pour lancer le diagnostic.');
      return;
    }

    if (!photoRightsConfirmed) {
      setError('Merci de confirmer que tu es autorisé à utiliser ces photos avant de lancer le diagnostic.');
      return;
    }

    setLoading(true);
    try {
      const images = await Promise.all(
        photos.map(async (file) => ({
          media_type: 'image/jpeg',
          data: await compressImage(file)
        }))
      );

      let dpeDocument = null;
      if (dpeFile) {
        const isPdf = dpeFile.type === 'application/pdf';
        dpeDocument = {
          media_type: isPdf ? 'application/pdf' : 'image/jpeg',
          data: isPdf ? await fileToBase64Raw(dpeFile) : await compressImage(dpeFile),
          isPdf
        };
      }

      const res = await fetch('/api/diagnostic', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ images, form, dpeDocument })
      });

      if (!res.ok) throw new Error(`Erreur serveur (${res.status})`);

      const data = await res.json();

      // Vérifie que le rapport contient vraiment du contenu avant de l'afficher.
      // Sans ça, une réponse vide ou mal formée s'affiche comme un rapport "vide" au lieu d'une erreur claire.
      const hasContent =
        data && typeof data.enveloppe_thermique === 'string' && data.enveloppe_thermique.trim().length > 0;

      if (!hasContent) {
        throw new Error('Réponse incomplète du serveur');
      }

      setResult(data);
    } catch (err) {
      console.error(err);
      if (photos.length >= 8) {
        setError('Le diagnostic a échoué, probablement à cause du nombre de photos (traitement trop long). Réessaie avec 5-6 photos maximum pour l\'instant.');
      } else {
        setError('Le diagnostic a échoué. Réessaie dans un instant.');
      }
    } finally {
      setLoading(false);
    }
  };

  const downloadPdf = () => {
    if (!result) return;
    const doc = new jsPDF();
    const marginX = 15;
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const bottomLimit = pageHeight - 20;
    const contentWidth = pageWidth - marginX * 2;

    const INK = [27, 42, 61];       // #1B2A3D
    const BLUEPRINT = [47, 92, 138]; // #2F5C8A
    const HEAT = [185, 83, 31];      // #B9531F
    const DIM = [91, 107, 125];      // #5B6B7D
    const LINE = [211, 220, 228];    // #D3DCE4

    let y = 22;
    let pageNum = 1;

    const drawFooter = () => {
      doc.setFontSize(8);
      doc.setTextColor(...DIM);
      doc.setFont(undefined, 'normal');
      doc.text('Moltes Habitat Pro — Diagnostic généré par IA — usage indicatif', marginX, pageHeight - 10);
      doc.text(String(pageNum), pageWidth - marginX, pageHeight - 10, { align: 'right' });
    };

    const addPageIfNeeded = (neededHeight) => {
      if (y + neededHeight > bottomLimit) {
        drawFooter();
        doc.addPage();
        pageNum += 1;
        y = 22;
      }
    };

    // Bandeau titre
    doc.setFillColor(...INK);
    doc.rect(0, 0, pageWidth, 32, 'F');
    doc.setFontSize(17);
    doc.setTextColor(255, 255, 255);
    doc.setFont(undefined, 'bold');
    doc.text('Diagnostic technique du bien', marginX, 18);
    doc.setFontSize(9);
    doc.setFont(undefined, 'normal');
    doc.setTextColor(200, 210, 220);
    doc.text('Moltes Habitat Pro — Diagnostic IA', marginX, 26);
    y = 42;

    doc.setFontSize(8.5);
    doc.setTextColor(...DIM);
    doc.text(
      "Généré par intelligence artificielle — usage indicatif, ne remplace pas une expertise sur site",
      marginX,
      y
    );
    y += 10;

    const addSection = (title, content, opts = {}) => {
      if (!content) return;
      const { boxColor, titleColor } = opts;
      doc.setFontSize(11.5);
      doc.setFont(undefined, 'bold');
      const lines = doc.splitTextToSize(content, contentWidth - (boxColor ? 10 : 0));
      const titleHeight = 7;
      const bodyHeight = lines.length * 5;
      const boxPadding = boxColor ? 8 : 0;
      const totalHeight = titleHeight + bodyHeight + boxPadding + 6;

      addPageIfNeeded(totalHeight);

      if (boxColor) {
        doc.setFillColor(...boxColor);
        doc.roundedRect(marginX - 4, y - 5, contentWidth + 8, totalHeight - 4, 2, 2, 'F');
      }

      doc.setTextColor(...(titleColor || BLUEPRINT));
      doc.setFontSize(10);
      doc.setFont(undefined, 'bold');
      doc.text(title.toUpperCase(), marginX, y);
      y += 6;

      doc.setTextColor(...INK);
      doc.setFontSize(10);
      doc.setFont(undefined, 'normal');
      doc.text(lines, marginX, y);
      y += bodyHeight + 9;
    };

    if (result.analyse_annonce) {
      const fiabiliteLine = result.fiabilite_annonce
        ? `Fiabilité de l'annonce : ${result.fiabilite_annonce}${result.fiabilite_annonce_detail ? ' — ' + result.fiabilite_annonce_detail : ''}\n\n`
        : '';
      addSection("Analyse du texte de l'annonce", fiabiliteLine + result.analyse_annonce, {
        boxColor: [228, 235, 242],
        titleColor: BLUEPRINT
      });
    }
    addSection('Enveloppe thermique', result.enveloppe_thermique);
    addSection('Chauffage / Ventilation', result.chauffage_ventilation);
    addSection(
      'Points de vigilance',
      (result.points_vigilance || []).map((p) => `• ${p}`).join('\n'),
      { boxColor: [243, 227, 216], titleColor: HEAT }
    );
    addSection(
      'Budget rénovation estimé',
      `${result.budget_estime || ''}\n${result.budget_detail || ''}`
    );
    if (result.arguments_negociation && result.arguments_negociation.length > 0) {
      addSection(
        'Arguments de négociation',
        result.arguments_negociation.map((a) => `• ${a}`).join('\n'),
        { boxColor: [239, 246, 241], titleColor: [47, 107, 79] }
      );
    }
    addSection('Score de transparence', result.score_transparence);

    // Ligne de séparation + disclaimer final
    addPageIfNeeded(20);
    doc.setDrawColor(...LINE);
    doc.line(marginX, y, pageWidth - marginX, y);
    y += 8;
    doc.setFontSize(8);
    doc.setTextColor(...DIM);
    const disclaimerLines = doc.splitTextToSize(
      "Ce diagnostic est généré par intelligence artificielle à partir de photos et d'informations déclarées. Il donne une orientation, pas une expertise certifiée — une visite et, si besoin, un professionnel restent nécessaires avant toute décision.",
      contentWidth
    );
    doc.text(disclaimerLines, marginX, y);

    drawFooter();
    doc.save('diagnostic-bien.pdf');
  };

  return (
    <div className="page">
      <header className="brandbar">
        <div>
          <div className="brand">Moltes Habitat <span>Pro</span></div>
        </div>
        <div className="brand-sub">DIAGNOSTIC IA</div>
      </header>

      <section className="hero">
        <div className="eyebrow">Avant de visiter, sachez à quoi vous attendre</div>
        <h1>On vous dit ce qui cloche.<br /><em>Pas ce qui vous fait rêver.</em></h1>
        <p className="lead">
          Un diagnostic technique honnête généré à partir des photos et du texte de l'annonce —
          isolation, chauffage, points de vigilance, budget travaux réaliste. Pas de rendu qui
          enjolive, juste ce qu'un œil d'expert verrait.
        </p>
        <ScanDiagram />
      </section>

      <div className="credibility">
        <div className="item"><strong>10+ ans</strong>expertise thermique &amp; bâtiment</div>
        <div className="item"><strong>10 000+</strong>abonnés Moltes Habitat</div>
        <div className="item"><strong>66 Minutes</strong>M6, novembre 2025</div>
      </div>

      <h2 className="section-title">Comment ça marche</h2>
      <div className="steps">
        <div className="step">
          <div className="num">01</div>
          <h3>Uploadez</h3>
          <p>Les photos du bien et le texte de l'annonce, copié-collé.</p>
        </div>
        <div className="step">
          <div className="num">02</div>
          <h3>L'IA analyse</h3>
          <p>Isolation, chauffage, signaux d'alerte — avec les incertitudes assumées.</p>
        </div>
        <div className="step">
          <div className="num">03</div>
          <h3>Rapport clair</h3>
          <p>Budget travaux réaliste et score de transparence, exportable en PDF.</p>
        </div>
      </div>

      <h2 className="section-title">Lancer un diagnostic</h2>
      <div className="form-card">
        <form onSubmit={handleSubmit} className="form">
          <label>
            Photos du bien (max 10)
            <span className="hint">Idéalement prises en visite. Inclure une photo de la façade extérieure améliore nettement l'analyse (isolation, ponts thermiques)</span>
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={handlePhotoChange}
              id="photo-input"
              className="file-input-hidden"
            />
            <div className="upload-zone">
              <label htmlFor="photo-input" className="upload-btn">
                Choisir des photos
              </label>
              <span className="upload-status">
                {photos.length === 0
                  ? 'Aucune photo sélectionnée'
                  : `${photos.length} photo${photos.length > 1 ? 's' : ''} sélectionnée${photos.length > 1 ? 's' : ''}`}
              </span>
            </div>
            {photos.length > 0 && (
              <ul className="file-list">
                {photos.map((f, i) => (
                  <li key={i}>{f.name}</li>
                ))}
              </ul>
            )}
          </label>

          {photos.length > 0 && (
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={photoRightsConfirmed}
                onChange={(e) => setPhotoRightsConfirmed(e.target.checked)}
              />
              Je confirme être autorisé à utiliser ces photos (prises par moi-même ou dont l'usage m'est permis)
            </label>
          )}

          <label>
            DPE officiel (PDF ou photo, optionnel)
            <span className="hint">Si vous l'avez, l'IA extrait les données exactes du document plutôt que de se fier au champ "DPE connu" seul</span>
            <input
              type="file"
              accept="application/pdf,image/*"
              onChange={(e) => setDpeFile(e.target.files[0] || null)}
              id="dpe-input"
              className="file-input-hidden"
            />
            <div className="upload-zone">
              <label htmlFor="dpe-input" className="upload-btn">Choisir un fichier</label>
              <span className="upload-status">
                {dpeFile ? dpeFile.name : 'Aucun fichier sélectionné'}
              </span>
            </div>
          </label>

          <label>
            Texte de l'annonce (optionnel)
            <span className="hint">Copiez-collez la description pour affiner l'analyse</span>
            <textarea
              name="annonce"
              value={form.annonce}
              onChange={handleFormChange}
              placeholder="Collez ici le texte de l'annonce..."
            />
          </label>

          <div className="grid">
            <label>
              Type de bien
              <select name="type_bien" value={form.type_bien} onChange={handleFormChange}>
                <option value="">Sélectionner…</option>
                <option value="Maison individuelle">Maison individuelle</option>
                <option value="Maison mitoyenne">Maison mitoyenne</option>
                <option value="Appartement">Appartement</option>
              </select>
            </label>
            <label>
              Localisation (ville ou code postal)
              <input name="localisation" value={form.localisation} onChange={handleFormChange} placeholder="ex : Metz, 57000" />
            </label>
            <label>
              Période de construction
              <select name="periode_construction" value={form.periode_construction} onChange={handleFormChange}>
                <option value="">Sélectionner…</option>
                <option value="Avant 1950">Avant 1950</option>
                <option value="1950-1980">1950 - 1980</option>
                <option value="1980-2000">1980 - 2000</option>
                <option value="2000-2011">2000 - 2011</option>
                <option value="2012-2020">2012 - 2020</option>
                <option value="2020 et plus">2020 et plus</option>
                <option value="Je ne sais pas">Je ne sais pas</option>
              </select>
            </label>
            <label>
              Année exacte (si connue)
              <input name="annee_exacte" value={form.annee_exacte} onChange={handleFormChange} placeholder="ex : 1985" />
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                name="renovation_recente"
                checked={form.renovation_recente}
                onChange={handleFormChange}
              />
              Rénovation thermique connue (même partielle)
            </label>
            <label>
              Surface (m²)
              <input name="surface" value={form.surface} onChange={handleFormChange} placeholder="ex : 95" />
            </label>
            <label>
              Type de chauffage
              <input name="chauffage" value={form.chauffage} onChange={handleFormChange} placeholder="ex : gaz, PAC" />
            </label>
            <label>
              DPE connu (optionnel)
              <input name="dpe" value={form.dpe} onChange={handleFormChange} placeholder="ex : D" />
            </label>
          </div>

          <button type="submit" disabled={loading}>
            {loading ? 'Analyse en cours…' : 'Lancer le diagnostic'}
          </button>

          {loading && (
            <div className="loading-block">
              <p className="loading-message">{loadingMessages[loadingStep]}</p>
              <div className="progress-track">
                <div
                  className="progress-fill"
                  style={{ width: `${((loadingStep + 1) / loadingMessages.length) * 90}%` }}
                />
              </div>
            </div>
          )}
        </form>
      </div>

      {error && <p className="error">{error}</p>}

      {result && (
        <div className="result">
          <div className="result-header">
            <h2>Rapport de diagnostic</h2>
            <span className="tag">Généré par IA</span>
          </div>

          {result.analyse_annonce && (
            <div className="section annonce">
              <h3>Analyse du texte de l'annonce</h3>
              {result.fiabilite_annonce && (
                <div className={`reliability-badge reliability-${reliabilityClass(result.fiabilite_annonce)}`}>
                  Fiabilité de l'annonce : {result.fiabilite_annonce}
                </div>
              )}
              <p>{result.analyse_annonce}</p>
              {result.fiabilite_annonce_detail && (
                <p className="reliability-detail">{result.fiabilite_annonce_detail}</p>
              )}
            </div>
          )}
          <div className="section">
            <h3>Enveloppe thermique</h3>
            <p>{result.enveloppe_thermique}</p>
          </div>
          <div className="section">
            <h3>Chauffage / Ventilation</h3>
            <p>{result.chauffage_ventilation}</p>
          </div>
          <div className="section vigilance">
            <h3>Points de vigilance</h3>
            <ul>
              {(result.points_vigilance || []).map((p, i) => <li key={i}>{p}</li>)}
            </ul>
          </div>
          <div className="section budget">
            <h3>Budget rénovation estimé</h3>
            <span className="value">{result.budget_estime}</span>
            <p>{result.budget_detail}</p>
          </div>
          {result.arguments_negociation && result.arguments_negociation.length > 0 && (
            <div className="section negociation">
              <h3>Arguments de négociation</h3>
              <ul>
                {result.arguments_negociation.map((arg, i) => (
                  <li key={i}>{arg}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="section">
            <h3>Score de transparence</h3>
            <p>{result.score_transparence}</p>
          </div>

          <button onClick={downloadPdf} className="secondary">Télécharger le PDF</button>

          <p className="disclaimer">
            Ce diagnostic est généré par intelligence artificielle à partir de photos et
            d'informations déclarées. Il donne une orientation, pas une expertise certifiée —
            une visite et, si besoin, un professionnel restent nécessaires avant toute décision.
          </p>
        </div>
      )}

      <footer className="footer">
        <span>Moltes Habitat Pro © 2026 — Tous droits réservés</span>
        <a href="/mentions-legales.html" className="footer-link">Mentions légales & confidentialité</a>
        <span>Diagnostic généré par IA — usage indicatif</span>
      </footer>
    </div>
  );
}