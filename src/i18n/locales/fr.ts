export type TranslationDictionary = Record<string, string>;

export const fr: TranslationDictionary = {
  // Application & En-tête
  'app.title': 'Live-Coach Biomécanique Edge/Cloud (Zéro-Média Privacy)',
  'header.title': 'Live-Coach Edge / Cloud',
  'header.privacyBadge': '🛡️ ZÉRO VIDÉO / AUDIO ENREGISTRÉS — Traitement VRAM éphémère',
  'header.agent1Status': 'Agent 1 (Edge) : WebGPU / 60 Hz',
  'header.agent2Connected': 'Agent 2 (Cloud) : Connecté WebSocket',
  'header.agent2Local': 'Agent 2 (Cloud) : Mode Réflexe Local',
  'header.langLabel': 'Langue',

  // Viewport & HUD
  'viewport.title': 'SURVEILLANCE BIOMÉCANIQUE (SQUAT)',
  'viewport.modeSim': 'Mode Simulateur Actif',
  'viewport.modeConnecting': 'Connexion à la caméra...',
  'viewport.modeLive': 'Mode Webcam Direct (WebGPU)',
  'viewport.accessibilityHint': 'Accessibilité : Malentendants (HUD) & Malvoyants (Earcons + TTS)',
  'hud.coachCueBadge': 'CONSIGNE DU COACH',
  'hud.defaultToast': 'Pousse le sol et écarte les genoux !',
  'hud.tempo': 'TEMPO',
  'hud.reps': 'Reps',
  'hud.repValidated': 'Répétition #{rep} validée ({duration}s) — Score : {score}%',

  // Phases du Squat
  'phase.IDLE': 'PRÊT',
  'phase.DESCENT': 'DESCENTE (3s)',
  'phase.BOTTOM': 'POINT BAS',
  'phase.ASCENT': 'REMONTÉE (1s)',
  'phase.COMPLETED': 'VALIDÉ',

  // Contrôles & Accessibilité
  'controls.enableWebcam': 'Activer la Webcam (WebGPU)',
  'controls.disableWebcam': 'Désactiver la Webcam',
  'controls.webcamError': "Impossible d'accéder à la webcam : {message}",
  'controls.audioTitle': 'Retours sonores rythmiques (Earcons) pour personnes malvoyantes',
  'controls.audioEarcons': '🔊 Bips rythmiques (Earcons)',
  'controls.ttsTitle': 'Lecture vocale des corrections du coach pour personnes malvoyantes',
  'controls.ttsVoice': '🗣️ Synthèse vocale (TTS)',

  // Banc d'essai de scénarios
  'scenarios.title': "Banc d'Essai d'Anomalies (Test instantané de l'Agent 1 & Agent 2)",
  'scenarios.nominal': '🟢 Squat Nominal',
  'scenarios.valgus': '⚠️ Valgus Genoux',
  'scenarios.fast': '⚠️ Descente Trop Rapide',
  'scenarios.depth': '⚠️ Demi-Squat',
  'scenarios.torso': '⚠️ Buste Penché',

  // Carte 1 : Progression Multi-Facteurs
  'progression.title': 'Évolution & Progression du Geste',
  'progression.globalScore': 'Score Global :',
  'progression.stability': '🛡️ Stabilité (Valgus)',
  'progression.tempo': '⏱️ Contrôle Tempo (3s)',
  'progression.depth': '📏 Profondeur (≤ 95°)',
  'progression.posture': '🧘 Posture Buste (≤ 32°)',
  'progression.endSessionBtn': 'Terminer la Série & Obtenir le Bilan Cloud',
  'progression.debriefTtsAnnouncement': 'Voici le bilan de progression de ta série.',

  // Carte 2 : Télémétrie 60 Hz
  'telemetry.title': 'Télémétrie Cinématique Locale',
  'telemetry.kneeAngle': 'Angle Genou',
  'telemetry.torsoAngle': 'Angle Buste',
  'telemetry.valgusRatio': 'Ratio Valgus',

  // Carte 3 : Inspecteur Cloud Agent 1 -> Agent 2
  'inspector.title': 'Pont Événementiel Agent 1 ➔ Agent 2',
  'inspector.subtitle': 'Zéro Pixel / Purement Métrique',
  'inspector.promptLabel': 'PROMPT ENVOYÉ AU CLOUD SUR ANOMALIE :',
  'inspector.waitingAnomaly': "En attente d'une anomalie détectée par l'Agent 1...",
  'inspector.responseLabel': "CONSIGNE GÉNÉRÉE PAR L'AGENT 2 (CLOUD LLM) :",
  'inspector.waitingIntervention': "En attente d'intervention...",

  // Carte 4 : Journal d'Audit SQLite
  'audit.title': "Journal d'Audit de Confidentialité (SQLite)",
  'audit.clearBtn': 'Effacer',
  'audit.colTime': 'Heure',
  'audit.colAnomaly': 'Anomalie',
  'audit.colRep': 'Rep',
  'audit.colCue': 'Conseil Fourni',
  'audit.colLatency': 'Latence',
  'audit.empty': 'Aucun incident pour le moment (Mouvement nominal).',

  // Détecteur d'anomalies (Explications)
  'anomaly.torsoDescent': 'Buste trop penché vers l’avant',
  'anomaly.valgusDescent': 'Genoux rentrant vers l’intérieur en descente',
  'anomaly.tempoFast': 'Descente trop brusque ({duration}s < 1.5s)',
  'anomaly.insufficientDepth': 'Amplitude incomplète (point bas à {angle}°)',
  'anomaly.valgusAscent': 'Affaissement des genoux vers l’intérieur à la remontée',
  'anomaly.torsoAscent': 'Buste trop incliné en phase de poussée',

  // Consignes réflexes locales (Agent 2 Bridge)
  'cue.default': 'Pousse le sol et écarte les genoux !',
  'cue.valgus': 'Écarte les genoux vers l’extérieur !',
  'cue.tempo': 'Ralentis la descente, contrôle la charge !',
  'cue.depth': 'Descends plus bas, casse la parallèle !',
  'cue.torso': 'Buste droit, sors la poitrine !'
};

export default fr;
