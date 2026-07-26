/**
 * The copy, in one place per language.
 *
 * A flat object rather than nested namespaces: the keys are already namespaced by their prefix,
 * and flat means `keyof typeof en` is the complete list of valid keys — so a typo is a compile
 * error rather than a string that renders as `room.cdoe` in production.
 *
 * French is typed as `Record<TranslationKey, string>`, which makes a missing translation a build
 * failure too. That is deliberate: a half-translated app is worse than an untranslated one,
 * because the gaps are invisible until someone who only reads French finds them.
 */
export const en = {
  /* ---- language ---------------------------------------------------------------------------- */
  'language.label': 'Language',
  'language.en': 'English',
  'language.fr': 'Français',

  /* ---- room header ------------------------------------------------------------------------- */
  'room.code': 'Code',
  'room.copyCode': 'Copy code',
  'room.codeCopied': 'Copied',
  'room.generateCode': 'Generate new code',
  'room.noCode': 'No active code',
  'room.members': '{count} members',
  'room.membersOne': '1 member',
  'room.back': 'Back to your rooms',
  'room.leave': 'Leave room',

  /* ---- lobby ------------------------------------------------------------------------------- */
  'lobby.title': 'Game lobby',
  'lobby.noGame': 'No game running',
  'lobby.noGameHost': 'Pick a theme and start a new game with your friends.',
  'lobby.noGameMember': 'A host starts the game. You will see it here the moment they do.',
  'lobby.startGame': 'Start game',
  'lobby.starting': 'Starting…',
  'lobby.pickThemeFirst': 'Pick a theme to start',
  'lobby.liveTitle': '{theme} is running',
  'lobby.livePlayers': '{count} players',
  'lobby.livePlayersOne': '1 player',
  'lobby.rejoin': 'Back to the game',
  'lobby.join': 'Join the game',

  /* ---- themes ------------------------------------------------------------------------------ */
  'themes.title': 'Choose a theme',
  'themes.subtitle': 'Every player writes one anonymous text. The theme decides what.',
  'themes.yours': 'Yours',
  'themes.selected': 'Selected',
  'themes.loadFailed': 'Could not load the themes.',

  /* ---- players ----------------------------------------------------------------------------- */
  'players.title': 'Players',
  'players.online': 'Online',
  'players.role.OWNER': 'Owner',
  'players.role.COHOST': 'Co-host',
  'players.role.MEMBER': 'Member',
  'players.blocked': 'Blocked',
  'players.answers': 'Answers {count}',
  'players.punishments': '{count} punishments',
  'players.punishmentsOne': '1 punishment',
  'players.punish': 'Punish',
  'players.forgive': 'Forgive',
  'players.punishHint': 'They answer one more text next game',
  'players.forgiveHint': 'Clear their punishments',
  'players.you': 'you',

  /* ---- room settings ----------------------------------------------------------------------- */
  'settings.title': 'Room settings',
  'settings.show': 'Show room settings',
  'settings.hide': 'Hide room settings',
  'settings.customThemes': 'Your themes',
  'settings.history': 'Punishment history',

  /* ---- custom themes ----------------------------------------------------------------------- */
  'customThemes.empty': 'No themes of your own yet',
  'customThemes.emptyHost':
    'Write one, and it joins the defaults in this room’s picker. Nobody outside the room ever sees it.',
  'customThemes.emptyMember':
    'A host can write themes for this room. They appear in the picker alongside the defaults.',
  'customThemes.write': 'Write a theme',
  'customThemes.writeAnother': 'Write another',
  'customThemes.edit': 'Edit {name}',
  'customThemes.delete': 'Delete {name}',
  'customThemes.inUse': 'in use',
  'customThemes.inUseCount':
    '{count} games use this theme, so it cannot change until they are deleted.',
  'customThemes.inUseCountOne': '1 game uses this theme, so it cannot change until it is deleted.',
  'customThemes.formTitle': 'Write a theme',
  'customThemes.formTitleEdit': 'Edit {name}',
  'customThemes.formIntro':
    'The prompts are what players read. The write prompt is pinned above the composer; the answer prompt appears on every card they are dealt.',
  'customThemes.name': 'Name',
  'customThemes.icon': 'Icon',
  'customThemes.iconHint': 'One emoji. It sits in the picker and in the banner all game.',
  'customThemes.description': 'Description',
  'customThemes.descriptionHint': 'One line, shown in the picker.',
  'customThemes.writePrompt': 'Write prompt',
  'customThemes.writePromptHint': 'What each player is asked to write.',
  'customThemes.placeholder': 'Placeholder',
  'customThemes.placeholderHint': 'Optional. Greyed-out example text in the composer.',
  'customThemes.answerPrompt': 'Answer prompt',
  'customThemes.answerPromptHint':
    'What a player is asked when they are dealt someone else’s text.',
  'customThemes.duringDiscussion': 'During the discussion',
  'customThemes.comments': 'Comments and reactions',
  'customThemes.guessing': 'Guessing who wrote what',
  'customThemes.save': 'Add it to the picker',
  'customThemes.saveEdit': 'Save changes',
  'customThemes.cancel': 'Never mind',

  /* ---- history ----------------------------------------------------------------------------- */
  'history.empty': 'Nothing yet. Punishments and forgiveness show up here for everyone to see.',
} as const;

export type TranslationKey = keyof typeof en;

export const fr: Record<TranslationKey, string> = {
  'language.label': 'Langue',
  'language.en': 'English',
  'language.fr': 'Français',

  'room.code': 'Code',
  'room.copyCode': 'Copier le code',
  'room.codeCopied': 'Copié',
  'room.generateCode': 'Générer un nouveau code',
  'room.noCode': 'Aucun code actif',
  'room.members': '{count} membres',
  'room.membersOne': '1 membre',
  'room.back': 'Retour à vos salles',
  'room.leave': 'Quitter la salle',

  'lobby.title': 'Salon de jeu',
  'lobby.noGame': 'Aucune partie en cours',
  'lobby.noGameHost': 'Choisissez un thème et lancez une partie avec vos amis.',
  'lobby.noGameMember': 'Un hôte lance la partie. Elle apparaîtra ici dès qu’il le fera.',
  'lobby.startGame': 'Démarrer la partie',
  'lobby.starting': 'Lancement…',
  'lobby.pickThemeFirst': 'Choisissez un thème pour commencer',
  'lobby.liveTitle': '{theme} est en cours',
  'lobby.livePlayers': '{count} joueurs',
  'lobby.livePlayersOne': '1 joueur',
  'lobby.rejoin': 'Revenir à la partie',
  'lobby.join': 'Rejoindre la partie',

  'themes.title': 'Choisissez un thème',
  'themes.subtitle': 'Chaque joueur écrit un texte anonyme. Le thème décide de quoi.',
  'themes.yours': 'À vous',
  'themes.selected': 'Sélectionné',
  'themes.loadFailed': 'Impossible de charger les thèmes.',

  'players.title': 'Joueurs',
  'players.online': 'En ligne',
  'players.role.OWNER': 'Propriétaire',
  'players.role.COHOST': 'Co-hôte',
  'players.role.MEMBER': 'Membre',
  'players.blocked': 'Bloqué',
  'players.answers': 'Répond à {count}',
  'players.punishments': '{count} punitions',
  'players.punishmentsOne': '1 punition',
  'players.punish': 'Punir',
  'players.forgive': 'Pardonner',
  'players.punishHint': 'Il répondra à un texte de plus à la prochaine partie',
  'players.forgiveHint': 'Effacer ses punitions',
  'players.you': 'vous',

  'settings.title': 'Paramètres de la salle',
  'settings.show': 'Afficher les paramètres',
  'settings.hide': 'Masquer les paramètres',
  'settings.customThemes': 'Vos thèmes',
  'settings.history': 'Historique des punitions',

  'customThemes.empty': 'Aucun thème personnalisé pour l’instant',
  'customThemes.emptyHost':
    'Écrivez-en un : il rejoindra les thèmes par défaut dans le sélecteur de cette salle. Personne à l’extérieur ne le verra.',
  'customThemes.emptyMember':
    'Un hôte peut écrire des thèmes pour cette salle. Ils apparaîtront dans le sélecteur à côté des thèmes par défaut.',
  'customThemes.write': 'Écrire un thème',
  'customThemes.writeAnother': 'En écrire un autre',
  'customThemes.edit': 'Modifier {name}',
  'customThemes.delete': 'Supprimer {name}',
  'customThemes.inUse': 'utilisé',
  'customThemes.inUseCount':
    '{count} parties utilisent ce thème : il ne peut pas changer avant leur suppression.',
  'customThemes.inUseCountOne':
    '1 partie utilise ce thème : il ne peut pas changer avant sa suppression.',
  'customThemes.formTitle': 'Écrire un thème',
  'customThemes.formTitleEdit': 'Modifier {name}',
  'customThemes.formIntro':
    'Les consignes sont ce que lisent les joueurs. La consigne d’écriture est épinglée au-dessus de l’éditeur ; la consigne de réponse apparaît sur chaque carte distribuée.',
  'customThemes.name': 'Nom',
  'customThemes.icon': 'Icône',
  'customThemes.iconHint': 'Un emoji. Il apparaît dans le sélecteur et dans la bannière.',
  'customThemes.description': 'Description',
  'customThemes.descriptionHint': 'Une ligne, affichée dans le sélecteur.',
  'customThemes.writePrompt': 'Consigne d’écriture',
  'customThemes.writePromptHint': 'Ce que chaque joueur doit écrire.',
  'customThemes.placeholder': 'Exemple',
  'customThemes.placeholderHint': 'Facultatif. Texte grisé affiché dans l’éditeur.',
  'customThemes.answerPrompt': 'Consigne de réponse',
  'customThemes.answerPromptHint':
    'Ce qu’on demande à un joueur quand il reçoit le texte de quelqu’un d’autre.',
  'customThemes.duringDiscussion': 'Pendant la discussion',
  'customThemes.comments': 'Commentaires et réactions',
  'customThemes.guessing': 'Deviner qui a écrit quoi',
  'customThemes.save': 'Ajouter au sélecteur',
  'customThemes.saveEdit': 'Enregistrer',
  'customThemes.cancel': 'Annuler',

  'history.empty':
    'Rien pour l’instant. Les punitions et les pardons apparaîtront ici, visibles par tous.',
};

export const TRANSLATIONS = { en, fr };

export type Locale = keyof typeof TRANSLATIONS;

export const LOCALES = Object.keys(TRANSLATIONS) as Locale[];
