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

// Convertit les premières pages d'un PDF en images JPEG compressées, directement dans le navigateur.
// Évite d'envoyer un PDF lourd (souvent 3-6 Mo) : on ne garde que les pages utiles, en léger.
async function pdfToCompressedImages(file, maxPages = 2) {
  if (!window.pdfjsLib) {
    throw new Error('La librairie de lecture PDF n\'a pas pu charger. Réessaie dans quelques secondes.');
  }
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const pageCount = Math.min(pdf.numPages, maxPages);
  const images = [];

  for (let i = 1; i <= pageCount; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 1.5 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport }).promise;

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.8));
    const base64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
    images.push({ media_type: 'image/jpeg', data: base64 });
  }

  return images;
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
  const [chauffageOpen, setChauffageOpen] = useState(false);
  const [rafraichissementOpen, setRafraichissementOpen] = useState(false);
  const [dpeFile, setDpeFile] = useState(null);
  const [photos, setPhotos] = useState([]);
  const [form, setForm] = useState({
    periode_construction: '',
    annee_exacte: '',
    renovation_recente: false,
    ventilation_declaree: '',
    piscine: false,
    panneaux_solaires: false,
    systeme_rafraichissement: [],
    production_eau_chaude: '',
    surface: '',
    type_bien: '',
    localisation: '',
    chauffage: [],
    dpe: '',
    annonce: '',
    nom_agence: '',
    reference_bien: ''
  });
  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState(0);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const handlePhotoChange = (e) => {
    const maxPhotos = dpeFile ? 6 : 10;
    const files = Array.from(e.target.files).slice(0, maxPhotos);
    setPhotos(files);
  };

  const removePhoto = (index) => {
    setPhotos((prev) => prev.filter((_, i) => i !== index));
  };

  const handleDpeFileChange = (e) => {
    const file = e.target.files[0] || null;
    setDpeFile(file);
    // Si un DPE est ajouté et qu'il y a déjà plus de 6 photos, on retaille automatiquement
    if (file && photos.length > 6) {
      setPhotos((prev) => prev.slice(0, 6));
    }
  };

  const handleFormChange = (e) => {
    const { name, type, value, checked } = e.target;
    setForm({ ...form, [name]: type === 'checkbox' ? checked : value });
  };

  const toggleMultiSelect = (field, option, exclusiveOptions = []) => {
    setForm((prev) => {
      const exclusive = exclusiveOptions.includes(option);
      let current = prev[field];

      if (current.includes(option)) {
        // On décoche l'option déjà sélectionnée
        return { ...prev, [field]: current.filter((o) => o !== option) };
      }

      if (exclusive) {
        // Une option exclusive (ex: "Aucun"/"Je ne sais pas") efface toute autre sélection
        return { ...prev, [field]: [option] };
      }

      // Sélectionner une vraie option retire les options exclusives déjà cochées
      current = current.filter((o) => !exclusiveOptions.includes(o));
      return { ...prev, [field]: [...current, option] };
    });
  };

  const toggleRafraichissement = (option) =>
    toggleMultiSelect('systeme_rafraichissement', option, ['Aucun', 'Je ne sais pas']);

  const toggleChauffage = (option) =>
    toggleMultiSelect('chauffage', option, ['Je ne sais pas']);

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

    const hasAnnonce = form.annonce && form.annonce.trim().length > 0;

    if (photos.length === 0 && !dpeFile && !hasAnnonce) {
      setError('Ajoute au moins des photos, un DPE, ou le texte de l\'annonce pour lancer le diagnostic.');
      return;
    }

    if (photos.length > 0 && !photoRightsConfirmed) {
      setError('Merci de confirmer que tu es autorisé à utiliser ces photos avant de lancer le diagnostic.');
      return;
    }

    if (dpeFile && photos.length > 6) {
      setError('Avec un DPE joint, limite-toi à 6 photos maximum pour l\'instant (limite du plan gratuit). Réduis le nombre de photos ou retire le DPE.');
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

      let dpeImages = [];
      if (dpeFile) {
        const isPdf = dpeFile.type === 'application/pdf';
        dpeImages = isPdf
          ? await pdfToCompressedImages(dpeFile)
          : [{ media_type: 'image/jpeg', data: await compressImage(dpeFile) }];
      }

      const res = await fetch('/api/diagnostic', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ images, form, dpeImages })
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
      doc.setFontSize(7);
      doc.setTextColor(...DIM);
      doc.setFont(undefined, 'normal');
      doc.text('Simulation non contractuelle — outil Moltes Habitat Pro', marginX, pageHeight - 10);
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

    // Bandeau titre — dynamique selon l'agence renseignée
    doc.setFillColor(...INK);
    doc.rect(0, 0, pageWidth, 32, 'F');
    doc.setFontSize(17);
    doc.setTextColor(255, 255, 255);
    doc.setFont(undefined, 'bold');
    const titreDoc = form.reference_bien
      ? `Diagnostic technique — ${form.reference_bien}`
      : 'Diagnostic technique du bien';
    doc.text(titreDoc, marginX, 18);
    doc.setFontSize(9);
    doc.setFont(undefined, 'normal');
    doc.setTextColor(200, 210, 220);
    const sousTitreDoc = form.nom_agence
      ? `Préparé par ${form.nom_agence}`
      : 'Moltes Habitat Pro — Diagnostic IA';
    doc.text(sousTitreDoc, marginX, 26);
    y = 42;

    doc.setFontSize(8.5);
    doc.setTextColor(...DIM);
    doc.text(
      'Simulation générée par intelligence artificielle — usage indicatif uniquement',
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
    const budgetPostesText =
      result.budget_postes && result.budget_postes.length > 0
        ? '\n\n' + result.budget_postes.map((p) => `• ${p.poste} : ${p.montant}`).join('\n')
        : '';
    addSection(
      'Budget rénovation estimé',
      `${result.budget_estime || ''}\n${result.budget_detail || ''}${budgetPostesText}`
    );
    if (result.arguments_negociation && result.arguments_negociation.length > 0) {
      addSection(
        'Arguments de négociation',
        result.arguments_negociation.map((a) => `• ${a}`).join('\n'),
        { boxColor: [239, 246, 241], titleColor: [47, 107, 79] }
      );
    }
    if (result.questions_reponses && result.questions_reponses.length > 0) {
      const qaText = result.questions_reponses
        .map((qa) => `Q: ${qa.question}\nR: ${qa.reponse}`)
        .join('\n\n');
      addSection('Questions probables de l\'acheteur — réponses prêtes', qaText);
    }
    addSection('Score de transparence', result.score_transparence);

    // Ligne de séparation + disclaimer final
    addPageIfNeeded(28);
    doc.setDrawColor(...LINE);
    doc.line(marginX, y, pageWidth - marginX, y);
    y += 8;
    doc.setFontSize(8);
    doc.setFont(undefined, 'bold');
    doc.setTextColor(...HEAT);
    doc.text('SIMULATION NON CONTRACTUELLE', marginX, y);
    y += 5;
    doc.setFont(undefined, 'normal');
    doc.setTextColor(...DIM);
    const disclaimerLines = doc.splitTextToSize(
      "Ce document est une simulation générée par intelligence artificielle à partir de photos et d'informations déclarées, sans valeur contractuelle ni expertise certifiée. Il ne remplace en aucun cas un diagnostic réglementaire, une expertise professionnelle sur site, ni des devis d'artisans qualifiés. Les montants indiqués sont des ordres de grandeur indicatifs, non garantis. L'utilisateur de ce rapport reste seul responsable de son usage et des décisions prises sur cette base.",
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
        <div className="eyebrow">Outil pro pour agents & chasseurs immobiliers</div>
        <h1>Soyez transparent.<br /><em>Ayez les réponses avant les questions.</em></h1>
        <p className="lead">
          Diagnostic technique complet généré à partir de photos et du texte de l'annonce :
          isolation, chauffage, points de vigilance, budget travaux chiffré et arguments de
          négociation prêts à l'emploi. Ce qu'un œil d'expert verrait, en 30 secondes.
          Repassez aussi vos anciennes annonces au crible pour débloquer ou améliorer vos chances de vente.
        </p>
        <p className="lead-punch">
          Transformez le doute de l'acheteur en confiance, et l'aveuglement du vendeur en réalisme.
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
          <h3>Préparation</h3>
          <p>Photos du bien, texte de l'annonce, et le DPE officiel si vous l'avez — tout est utilisé. Simulez aussi votre texte avant parution de l'annonce !</p>
        </div>
        <div className="step">
          <div className="num">02</div>
          <h3>L'IA analyse</h3>
          <p>Isolation, chauffage, cohérence DPE — les données officielles priment, les incertitudes sont assumées.</p>
        </div>
        <div className="step">
          <div className="num">03</div>
          <h3>Répondez avec assurance</h3>
          <p>Budget chiffré, arguments de négociation et réponses aux questions acheteurs, prêts en PDF.</p>
        </div>
      </div>

      <h2 className="section-title">Préparer le bien</h2>
      <div className="form-card">
        <form onSubmit={handleSubmit} className="form">
          <div className="grid">
            <label>
              Nom de votre agence (optionnel)
              <span className="hint">Apparaît sur le PDF exporté</span>
              <input name="nom_agence" value={form.nom_agence} onChange={handleFormChange} placeholder="ex : Agence Dupont Immobilier" />
            </label>
            <label>
              Référence du bien (optionnel)
              <span className="hint">Pour vous y retrouver dans vos dossiers</span>
              <input name="reference_bien" value={form.reference_bien} onChange={handleFormChange} placeholder="ex : Maison Rue des Lilas - REF102" />
            </label>
          </div>

          <label>
            Photos du bien (optionnel, max 10)
            <span className="hint">Idéalement prises en visite. Inclure une photo de la façade extérieure améliore nettement l'analyse (isolation, ponts thermiques). La limite passe automatiquement à 6 si vous joignez un DPE.</span>
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
              <div className="thumb-grid">
                {photos.map((f, i) => (
                  <div key={i} className="thumb-item">
                    <img src={URL.createObjectURL(f)} alt={f.name} />
                    <button
                      type="button"
                      className="thumb-remove"
                      onClick={() => removePhoto(i)}
                      aria-label={`Retirer ${f.name}`}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
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
            <span className="hint">Si vous l'avez, l'IA extrait les données exactes du document plutôt que de se fier au champ "DPE connu" seul. Les PDF sont automatiquement allégés (2 premières pages).</span>
            <input
              type="file"
              accept="application/pdf,image/*"
              onChange={handleDpeFileChange}
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
            <label>
              Surface (m²)
              <input name="surface" value={form.surface} onChange={handleFormChange} placeholder="ex : 95" />
            </label>
            <label>
              DPE connu (optionnel)
              <input name="dpe" value={form.dpe} onChange={handleFormChange} placeholder="ex : D" />
            </label>
            <label>
              Type de ventilation (si connu)
              <select name="ventilation_declaree" value={form.ventilation_declaree} onChange={handleFormChange}>
                <option value="">Sélectionner…</option>
                <option value="VMC simple flux">VMC simple flux</option>
                <option value="VMC double flux">VMC double flux</option>
                <option value="Ventilation naturelle">Ventilation naturelle</option>
                <option value="Je ne sais pas">Je ne sais pas</option>
              </select>
            </label>
            <label>
              Production d'eau chaude (si connue)
              <select name="production_eau_chaude" value={form.production_eau_chaude} onChange={handleFormChange}>
                <option value="">Sélectionner…</option>
                <option value="Ballon électrique (cumulus)">Ballon électrique (cumulus)</option>
                <option value="Chauffe-eau thermodynamique">Chauffe-eau thermodynamique</option>
                <option value="Chauffe-eau solaire">Chauffe-eau solaire</option>
                <option value="Couplée à une chaudière gaz">Couplée à une chaudière gaz</option>
                <option value="Couplée à une chaudière fioul">Couplée à une chaudière fioul</option>
                <option value="Couplée à une PAC">Couplée à une PAC</option>
                <option value="Je ne sais pas">Je ne sais pas</option>
              </select>
            </label>
          </div>

          <div className="collapsible">
            <button
              type="button"
              className="collapsible-header"
              onClick={() => setChauffageOpen(!chauffageOpen)}
            >
              <span>Type de chauffage (cochez tout ce qui s'applique)</span>
              <span className="collapsible-summary">
                {form.chauffage.length > 0 ? form.chauffage.join(', ') : 'Non renseigné'}
                <span className={`chevron ${chauffageOpen ? 'chevron-open' : ''}`}>▾</span>
              </span>
            </button>
            {chauffageOpen && (
              <div className="checkbox-grid">
                {['Gaz', 'Électrique (radiateurs/convecteurs)', 'PAC air-air', 'PAC air-eau', 'Chaudière fioul', 'Poêle/chaudière bois ou granulés', 'Chauffage collectif/réseau de chaleur', 'Autre', 'Je ne sais pas'].map((option) => (
                  <label key={option} className="checkbox-label checkbox-label-compact">
                    <input
                      type="checkbox"
                      checked={form.chauffage.includes(option)}
                      onChange={() => toggleChauffage(option)}
                    />
                    {option}
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="collapsible">
            <button
              type="button"
              className="collapsible-header"
              onClick={() => setRafraichissementOpen(!rafraichissementOpen)}
            >
              <span>Système(s) de rafraîchissement (si connu)</span>
              <span className="collapsible-summary">
                {form.systeme_rafraichissement.length > 0 ? form.systeme_rafraichissement.join(', ') : 'Non renseigné'}
                <span className={`chevron ${rafraichissementOpen ? 'chevron-open' : ''}`}>▾</span>
              </span>
            </button>
            {rafraichissementOpen && (
              <div className="checkbox-grid">
                {['Aucun', 'Climatisation réversible / PAC air-air (splits)', 'Puits canadien', 'Géothermie', 'VMC thermodynamique', 'Plancher rafraîchissant', 'Autre', 'Je ne sais pas'].map((option) => (
                  <label key={option} className="checkbox-label checkbox-label-compact">
                    <input
                      type="checkbox"
                      checked={form.systeme_rafraichissement.includes(option)}
                      onChange={() => toggleRafraichissement(option)}
                    />
                    {option}
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="grid">
            <label className="checkbox-label">
              <input
                type="checkbox"
                name="renovation_recente"
                checked={form.renovation_recente}
                onChange={handleFormChange}
              />
              Rénovation thermique connue (même partielle)
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                name="piscine"
                checked={form.piscine}
                onChange={handleFormChange}
              />
              Piscine sur le terrain
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                name="panneaux_solaires"
                checked={form.panneaux_solaires}
                onChange={handleFormChange}
              />
              Panneaux solaires installés
            </label>
          </div>

          <button type="submit" disabled={loading}>
            {loading ? 'Analyse en cours…' : 'Obtenir mes réponses'}
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
            {result.budget_postes && result.budget_postes.length > 0 && (
              <table className="budget-table">
                <tbody>
                  {result.budget_postes.map((p, i) => (
                    <tr key={i}>
                      <td>{p.poste}</td>
                      <td>{p.montant}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
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
          {result.questions_reponses && result.questions_reponses.length > 0 && (
            <div className="section qa">
              <h3>Questions probables de l'acheteur — réponses prêtes</h3>
              {result.questions_reponses.map((qa, i) => (
                <div key={i} className="qa-item">
                  <p className="qa-question">« {qa.question} »</p>
                  <p className="qa-reponse">{qa.reponse}</p>
                </div>
              ))}
            </div>
          )}
          <div className="section">
            <h3>Score de transparence</h3>
            <p>{result.score_transparence}</p>
          </div>

          <button onClick={downloadPdf} className="secondary">Télécharger le PDF</button>

          <p className="disclaimer">
            <strong>Simulation non contractuelle.</strong> Ce document est généré par intelligence
            artificielle à partir de photos et d'informations déclarées, sans valeur contractuelle
            ni expertise certifiée. Il ne remplace ni un diagnostic réglementaire, ni une expertise
            professionnelle sur site, ni des devis d'artisans qualifiés. L'utilisateur reste seul
            responsable de l'usage de ce document.
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