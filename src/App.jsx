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

// Extrait le texte brut du PDF (bien plus léger et fiable que des images pour les chiffres).
// On lit jusqu'à `maxPages` pages, mais on s'arrête si on croise la section "Etat des risques"
// (souvent accolée au DPE dans le même document) pour ne garder que la partie utile.
// Limite aussi la longueur totale pour contrôler le coût sur les très gros dossiers.
async function extractPdfText(file, maxPages = 10, maxChars = 9000) {
  if (!window.pdfjsLib) {
    throw new Error('La librairie de lecture PDF n\'a pas pu charger. Réessaie dans quelques secondes.');
  }
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const pageCount = Math.min(pdf.numPages, maxPages);
  let fullText = '';

  for (let i = 1; i <= pageCount; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items.map((item) => item.str).join(' ');

    // On arrête si on entre dans les annexes administratives (état des risques, etc.)
    // qui ne sont pas utiles pour le diagnostic thermique et gonflent inutilement le texte.
    if (/etat des risques|installations classées|nuisances sonores/i.test(pageText) && fullText.length > 500) {
      break;
    }

    fullText += `\n--- Page ${i} ---\n${pageText}`;
    if (fullText.length > maxChars) {
      fullText = fullText.slice(0, maxChars);
      break;
    }
  }

  return fullText.trim();
}

function reliabilityClass(value) {
  if (value === 'Élevée') return 'high';
  if (value === 'Moyenne') return 'medium';
  if (value === 'Faible') return 'low';
  return 'medium';
}

function PasteInstructions() {
  return (
    <div className="paste-instructions">
      <div className="paste-steps">
        <div className="paste-step">
          <span className="paste-step-num">1</span>
          <div className="keycap-row">
            <span className="keycap">⊞ Win</span>
            <span className="keycap-plus">+</span>
            <span className="keycap">⇧ Maj</span>
            <span className="keycap-plus">+</span>
            <span className="keycap keycap-highlight">S</span>
          </div>
          <span className="paste-step-label">Capturez une zone de l'écran</span>
        </div>
        <span className="paste-arrow">→</span>
        <div className="paste-step">
          <span className="paste-step-num">2</span>
          <div className="keycap-row">
            <span className="keycap">Cliquez</span>
            <span className="keycap-plus">sur</span>
            <span className="keycap">une zone</span>
          </div>
          <span className="paste-step-label">ci-dessous pour l'activer</span>
        </div>
        <span className="paste-arrow">→</span>
        <div className="paste-step">
          <span className="paste-step-num">3</span>
          <div className="keycap-row">
            <span className="keycap">Ctrl</span>
            <span className="keycap-plus">+</span>
            <span className="keycap keycap-highlight">V</span>
          </div>
          <span className="paste-step-label">Collez directement</span>
        </div>
      </div>
    </div>
  );
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
  const [mode, setMode] = useState('diagnostic'); // 'diagnostic' ou 'prix'
  const [chauffageOpen, setChauffageOpen] = useState(false);
  const [agentZoneOpen, setAgentZoneOpen] = useState(false);
  const [rafraichissementOpen, setRafraichissementOpen] = useState(false);
  const [dpeFile, setDpeFile] = useState(null);
  const [photos, setPhotos] = useState([]);
  const [comparableSlots, setComparableSlots] = useState([
    { photos: [], texte: '' },
    { photos: [], texte: '' },
    { photos: [], texte: '' },
    { photos: [], texte: '' },
    { photos: [], texte: '' }
  ]);
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
    const maxPhotos = 5;
    const files = Array.from(e.target.files).slice(0, maxPhotos);
    setPhotos(files);
  };

  const removePhoto = (index) => {
    setPhotos((prev) => prev.filter((_, i) => i !== index));
  };

  // Extrait une image collée depuis le presse-papier (capture d'écran via Ctrl+V)
  const getImageFromClipboard = (e) => {
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return null;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        return items[i].getAsFile();
      }
    }
    return null;
  };

  // 'main' pour les photos du bien, ou l'index du bien comparable (0-4)
  const [pasteTarget, setPasteTarget] = useState('main');

  useEffect(() => {
    const handleGlobalPaste = (e) => {
      const file = getImageFromClipboard(e);
      if (!file) return;
      e.preventDefault();
      if (pasteTarget === 'main') {
        setPhotos((prev) => [...prev, file].slice(0, 5));
      } else if (typeof pasteTarget === 'number') {
        setComparableSlots((prev) =>
          prev.map((slot, i) => (i === pasteTarget ? { ...slot, photos: [file] } : slot))
        );
      }
    };
    window.addEventListener('paste', handleGlobalPaste);
    return () => window.removeEventListener('paste', handleGlobalPaste);
  }, [pasteTarget]);

  const handleSlotPhotoChange = (slotIndex, e) => {
    const files = Array.from(e.target.files).slice(0, 1);
    setComparableSlots((prev) =>
      prev.map((slot, i) => (i === slotIndex ? { ...slot, photos: files } : slot))
    );
  };

  const removeSlotPhoto = (slotIndex, photoIndex) => {
    setComparableSlots((prev) =>
      prev.map((slot, i) =>
        i === slotIndex ? { ...slot, photos: slot.photos.filter((_, pi) => pi !== photoIndex) } : slot
      )
    );
  };

  const handleSlotTexteChange = (slotIndex, value) => {
    setComparableSlots((prev) =>
      prev.map((slot, i) => (i === slotIndex ? { ...slot, texte: value } : slot))
    );
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

  const loadingMessages = mode === 'prix'
    ? [
        "J'analyse les annonces comparables…",
        "Je consulte les données DVF officielles…",
        "Je calcule le prix moyen du secteur…",
        "Je positionne le bien par rapport au marché…",
        "Je vérifie la cohérence des chiffres…",
        "Patientez quelques instants, l'analyse est en cours…",
        "Finalisation de l'estimation…"
      ]
    : [
        "J'analyse vos photos…",
        "Je lis les données du DPE…",
        "Calcul de l'isolation et du chauffage…",
        "Je croise les informations de l'annonce…",
        "Je vérifie la cohérence des chiffres…",
        "Je prépare le budget travaux…",
        "Je rédige les arguments de négociation…",
        "Je prépare les réponses aux questions…",
        "Patientez quelques instants, l'analyse est en cours…",
        "Finalisation du rapport…"
      ];

  const [loadingElapsed, setLoadingElapsed] = useState(0);

  useEffect(() => {
    if (!loading) {
      setLoadingStep(0);
      setLoadingElapsed(0);
      return;
    }
    const stepInterval = setInterval(() => {
      // On boucle en continu plutôt que de se figer sur le dernier message :
      // une génération avec DPE + beaucoup de photos peut prendre jusqu'à 60s,
      // et un message figé donne l'impression que ça a planté.
      setLoadingStep((prev) => (prev + 1) % loadingMessages.length);
    }, 4000);
    const tickInterval = setInterval(() => {
      setLoadingElapsed((prev) => prev + 1);
    }, 1000);
    return () => {
      clearInterval(stepInterval);
      clearInterval(tickInterval);
    };
  }, [loading]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setResult(null);

    const hasAnnonce = form.annonce && form.annonce.trim().length > 0;
    const hasAnyComparable = comparableSlots.some(
      (slot) => slot.photos.length > 0 || slot.texte.trim().length > 0
    );

    if (photos.length === 0 && !dpeFile && !hasAnnonce && !hasAnyComparable) {
      setError('Ajoute au moins des photos, un DPE, des annonces comparables, ou le texte de l\'annonce pour lancer l\'analyse.');
      return;
    }

    if (photos.length > 0 && !photoRightsConfirmed) {
      setError('Merci de confirmer que tu es autorisé à utiliser ces photos avant de lancer le diagnostic.');
      return;
    }

    if (!/\b\d{5}\b/.test(form.localisation || '')) {
      setError('Indique un code postal valide dans "Localisation" (ex : 54880) avant de lancer l\'analyse — ça évite les erreurs de secteur.');
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

      const comparablesData = await Promise.all(
        comparableSlots
          .filter((slot) => slot.photos.length > 0 || slot.texte.trim().length > 0)
          .map(async (slot) => ({
            texte: slot.texte,
            images: await Promise.all(
              slot.photos.map(async (file) => ({
                media_type: 'image/jpeg',
                data: await compressImage(file)
              }))
            )
          }))
      );

      let dpeImages = [];
      let dpeText = '';
      if (dpeFile) {
        const isPdf = dpeFile.type === 'application/pdf';
        if (isPdf) {
          dpeText = await extractPdfText(dpeFile);
          // Si le PDF est un scan sans couche de texte (texte quasi vide extrait),
          // on bascule sur la conversion en images pour ne rien perdre.
          if (dpeText.length < 200) {
            dpeImages = await pdfToCompressedImages(dpeFile, 2);
            dpeText = '';
          }
        } else {
          dpeImages = [{ media_type: 'image/jpeg', data: await compressImage(dpeFile) }];
        }
      }

      const res = await fetch('/api/diagnostic', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ images, form, dpeImages, dpeText, comparablesData, mode })
      });

      if (!res.ok) throw new Error(`Erreur serveur (${res.status})`);

      const data = await res.json();

      // Pas de blocage strict ici : chaque section du rapport s'affiche déjà de façon
      // conditionnelle (result.xxx && ...), donc une réponse éparse s'affiche simplement
      // avec moins de sections plutôt que d'être bloquée en erreur.
      if (!data || typeof data !== 'object') {
        throw new Error('Réponse invalide du serveur');
      }

      setResult(data);
    } catch (err) {
      console.error(err);
      setError('Le diagnostic a échoué. Réessaie dans un instant.');
    } finally {
      setLoading(false);
    }
  };

  const downloadPdf = (mode = 'agent') => {
    if (!result) return;
    const includeNegotiation = mode === 'agent';
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

    if (result.verdict_global) {
      addSection('En bref', result.verdict_global, { boxColor: [228, 235, 242], titleColor: BLUEPRINT });
    }

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
    if (result.budget_estime) {
      const budgetPostesText =
        result.budget_postes && result.budget_postes.length > 0
          ? '\n\n' + result.budget_postes.map((p) => `• ${p.poste} : ${p.montant}`).join('\n')
          : '';
      addSection(
        'Budget rénovation estimé',
        `${result.budget_estime}\n${result.budget_detail || ''}${budgetPostesText}`
      );
    }
    if (result.cout_fonctionnement_annuel) {
      addSection(
        'Coût de fonctionnement annuel estimé',
        `${result.cout_fonctionnement_annuel}\nChauffage, eau chaude et entretien courant des systèmes cumulés.`,
        { boxColor: [239, 246, 241], titleColor: [47, 107, 79] }
      );
    }
    if (result.estimation_prix) {
      addSection(
        'Positionnement de prix (annonces comparables)',
        result.estimation_prix,
        { boxColor: [243, 232, 220], titleColor: [138, 90, 43] }
      );
    }
    if (includeNegotiation && result.arguments_negociation && result.arguments_negociation.length > 0) {
      addSection(
        'Arguments de négociation',
        result.arguments_negociation.map((a) => `• ${a}`).join('\n'),
        { boxColor: [239, 246, 241], titleColor: [47, 107, 79] }
      );
    }
    if (includeNegotiation && result.questions_reponses && result.questions_reponses.length > 0) {
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
    doc.save(includeNegotiation ? 'diagnostic-bien-agent.pdf' : 'diagnostic-bien-acheteur.pdf');
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

      <div className="mode-switch">
        <button
          type="button"
          className={`mode-btn ${mode === 'diagnostic' ? 'mode-btn-active' : ''}`}
          onClick={() => setMode('diagnostic')}
        >
          🏠 Diagnostic technique complet
        </button>
        <button
          type="button"
          className={`mode-btn ${mode === 'prix' ? 'mode-btn-active' : ''}`}
          onClick={() => setMode('prix')}
        >
          💰 Estimation de prix seule
        </button>
      </div>
      {mode === 'prix' && (
        <p className="mode-hint">
          Idéal pour relancer un vendeur qui bloque sur le prix. Gardez photos et DPE si vous
          les avez (ça ancre la comparaison), les détails techniques fins sont masqués ici.
        </p>
      )}
      <div className="form-card">
        <form onSubmit={handleSubmit} className="form">
          <PasteInstructions />

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
            Photos du bien (optionnel, max 5)
            <span className="hint">
              {mode === 'prix'
                ? "Recommandé pour ancrer l'estimation : l'IA compare l'état visible du bien aux annonces concurrentes."
                : "Idéalement prises en visite. Inclure une photo de la façade extérieure améliore nettement l'analyse (isolation, ponts thermiques)."}
            </span>
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={handlePhotoChange}
              id="photo-input"
              className="file-input-hidden"
            />
            <div
              className={`upload-zone ${pasteTarget === 'main' ? 'upload-zone-active' : ''}`}
              tabIndex="0"
              onClick={(e) => { setPasteTarget('main'); e.currentTarget.focus(); }}
            >
              <label htmlFor="photo-input" className="upload-btn">
                Choisir des photos
              </label>
              <span className="upload-status">
                {photos.length === 0
                  ? 'Aucune photo sélectionnée'
                  : `${photos.length} photo${photos.length > 1 ? 's' : ''} sélectionnée${photos.length > 1 ? 's' : ''}`}
              </span>
            </div>
            <span className="paste-hint">{pasteTarget === 'main' ? '✅ Zone active — collez maintenant (Ctrl+V)' : '👆 Cliquez ici pour choisir cette zone'}</span>
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

          {mode === 'prix' && (
          <div className="comparables-block">
            <h3 className="comparables-title">Annonces comparables (optionnel)</h3>
            <p className="hint comparables-intro">
              Jusqu'à 5 biens du même secteur — une photo (la fiche prix/résumé) et une description pour chacun.
            </p>
            {comparableSlots.map((slot, slotIndex) => (
              <div key={slotIndex} className="comparable-slot">
                <h4 className="comparable-slot-title">Bien comparable n°{slotIndex + 1}</h4>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => handleSlotPhotoChange(slotIndex, e)}
                  id={`comparable-input-${slotIndex}`}
                  className="file-input-hidden"
                />
                <div
                  className={`upload-zone ${pasteTarget === slotIndex ? 'upload-zone-active' : ''}`}
                  tabIndex="0"
                  onClick={(e) => { setPasteTarget(slotIndex); e.currentTarget.focus(); }}
                >
                  <label htmlFor={`comparable-input-${slotIndex}`} className="upload-btn">
                    Choisir la photo
                  </label>
                  <span className="upload-status">
                    {slot.photos.length === 0
                      ? 'Aucune photo'
                      : `${slot.photos.length} photo${slot.photos.length > 1 ? 's' : ''}`}
                  </span>
                </div>
                <span className="paste-hint">{pasteTarget === slotIndex ? '✅ Zone active — collez maintenant (Ctrl+V)' : '👆 Cliquez ici pour choisir cette zone'}</span>
                {slot.photos.length > 0 && (
                  <div className="thumb-grid">
                    {slot.photos.map((f, i) => (
                      <div key={i} className="thumb-item">
                        <img src={URL.createObjectURL(f)} alt={f.name} />
                        <button
                          type="button"
                          className="thumb-remove"
                          onClick={() => removeSlotPhoto(slotIndex, i)}
                          aria-label={`Retirer ${f.name}`}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <textarea
                  value={slot.texte}
                  onChange={(e) => handleSlotTexteChange(slotIndex, e.target.value)}
                  placeholder="Description de ce bien comparable (optionnel)..."
                  className="comparable-textarea"
                />
              </div>
            ))}
          </div>
          )}

          <label>
            DPE officiel (PDF ou photo, optionnel)
            <span className="hint">Si vous l'avez, l'IA extrait les données exactes du document plutôt que de se fier au champ "DPE connu" seul (texte lu directement, jusqu'à 10 pages).</span>
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
              Localisation (ville ou code postal) *
              <span className="hint">
                Obligatoire — évite les erreurs de secteur (zone climatique, prix du marché) en cas
                d'extraction automatique incorrecte depuis le DPE ou l'annonce.
              </span>
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
              Surface (m², optionnel)
              <span className="hint">Extraite automatiquement si vous joignez un DPE</span>
              <input name="surface" value={form.surface} onChange={handleFormChange} placeholder="ex : 95" />
            </label>
            <label>
              DPE connu (optionnel)
              <span className="hint">Extrait automatiquement si vous joignez un DPE</span>
              <input name="dpe" value={form.dpe} onChange={handleFormChange} placeholder="ex : D" />
            </label>
            {mode === 'diagnostic' && (
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
            )}
            {mode === 'diagnostic' && (
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
            )}
          </div>

          {mode === 'diagnostic' && (
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
          )}

          {mode === 'diagnostic' && (
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
          )}

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
            {loading ? 'Analyse en cours…' : mode === 'prix' ? 'Estimer le prix' : 'Obtenir mes réponses'}
          </button>

          {loading && (
            <div className="loading-block">
              <p className="loading-message">{loadingMessages[loadingStep]}</p>
              <div className="progress-track">
                <div
                  className="progress-fill"
                  style={{ width: `${Math.min(90, (loadingElapsed / 60) * 90)}%` }}
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

          {result.verdict_global && (
            <div className="verdict-global">
              {result.verdict_global}
            </div>
          )}

          {mode === 'prix'
            ? !result.verdict_global && !result.estimation_prix && (
                <p className="empty-report-note">
                  L'estimation n'a pas pu être générée avec les données fournies —
                  ajoute au moins une annonce comparable (photo ou description), puis relance.
                </p>
              )
            : !result.verdict_global && !result.enveloppe_thermique && !result.estimation_prix && !result.budget_estime && (
                <p className="empty-report-note">
                  L'analyse n'a pas pu produire de résultat exploitable avec les données fournies —
                  essaie d'ajouter des photos, un DPE ou des annonces comparables, puis relance.
                </p>
              )}

          {mode === 'diagnostic' && (
            <>
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
          {result.enveloppe_thermique && (
            <div className="section">
              <h3>Enveloppe thermique</h3>
              <p>{result.enveloppe_thermique}</p>
            </div>
          )}
          {result.chauffage_ventilation && (
            <div className="section">
              <h3>Chauffage / Ventilation</h3>
              <p>{result.chauffage_ventilation}</p>
            </div>
          )}
          {result.points_vigilance && result.points_vigilance.length > 0 && (
            <div className="section vigilance">
              <h3>Points de vigilance</h3>
              <ul>
                {result.points_vigilance.map((p, i) => <li key={i}>{p}</li>)}
              </ul>
            </div>
          )}
          {result.budget_estime && (
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
          )}
            </>
          )}
          {result.cout_fonctionnement_annuel && mode === 'diagnostic' && (
            <div className="section cout-annuel">
              <h3>Coût de fonctionnement annuel estimé</h3>
              <span className="value">{result.cout_fonctionnement_annuel}</span>
              <p className="cout-annuel-note">Chauffage, eau chaude et entretien courant des systèmes cumulés.</p>
            </div>
          )}
          {result.estimation_prix && (
            <div className="section estimation-prix">
              <h3>Positionnement de prix (annonces comparables)</h3>
              <p>{result.estimation_prix}</p>
            </div>
          )}
          {mode === 'diagnostic' && ((result.arguments_negociation && result.arguments_negociation.length > 0) ||
            (result.questions_reponses && result.questions_reponses.length > 0)) && (
            <div className="agent-zone">
              <button
                type="button"
                className="agent-zone-header"
                onClick={() => setAgentZoneOpen(!agentZoneOpen)}
              >
                <span>🔒 Zone agent — ne pas montrer à l'acheteur</span>
                <span className={`chevron ${agentZoneOpen ? 'chevron-open' : ''}`}>▾</span>
              </button>
              {agentZoneOpen && (
                <div className="agent-zone-content">
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
                </div>
              )}
            </div>
          )}
          {mode === 'diagnostic' && result.score_transparence && (
            <div className="section">
              <h3>Score de transparence</h3>
              <p>{result.score_transparence}</p>
            </div>
          )}

          <div className="pdf-buttons">
            <button onClick={() => downloadPdf('agent')} className="secondary">
              📋 Version complète (usage interne)
            </button>
            <button onClick={() => downloadPdf('acheteur')} className="secondary secondary-alt">
              📄 Version à partager (sans négociation)
            </button>
          </div>
          <p className="pdf-hint">
            La version complète inclut vos arguments de négociation et les réponses préparées —
            gardez-la pour vous. Utilisez la version "à partager" pour l'acheteur ou le vendeur.
          </p>

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