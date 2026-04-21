import { useMemo, useState, useRef, useEffect } from 'react';
import { Search, X, Smile, Hand, Leaf, UtensilsCrossed, Plane, Gamepad2, Lightbulb, Heart } from 'lucide-react';

export interface EmojiPanelProps {
  open: boolean;
  onClose: () => void;
  /** Called with the chosen emoji. Consumer is responsible for inserting at the correct position. */
  onSelect: (emoji: string) => void;
}

type EmojiCategory = {
  id: string;
  label: string;
  icon: React.ComponentType<{ size?: number }>;
  emojis: { char: string; name: string }[];
};

// Curated emoji set with human-readable names used for searching.
const CATEGORIES: EmojiCategory[] = [
  {
    id: 'smileys',
    label: 'Smileys et personnes',
    icon: Smile,
    emojis: [
      { char: '😀', name: 'grinning sourire' },
      { char: '😃', name: 'smiley joie' },
      { char: '😄', name: 'sourire heureux' },
      { char: '😁', name: 'beaming content' },
      { char: '😆', name: 'laughing rire' },
      { char: '😅', name: 'sweat rire nerveux' },
      { char: '🤣', name: 'rolling rire mdr' },
      { char: '😂', name: 'joy larmes rire' },
      { char: '🙂', name: 'slightly smile sourire' },
      { char: '🙃', name: 'upside down renversé' },
      { char: '😉', name: 'wink clin oeil' },
      { char: '😊', name: 'blush heureux timide' },
      { char: '😇', name: 'angel ange' },
      { char: '🥰', name: 'amoureux coeur love' },
      { char: '😍', name: 'heart eyes coeur amour' },
      { char: '🤩', name: 'star struck étoile fan' },
      { char: '😘', name: 'kiss bisou' },
      { char: '😗', name: 'kissing bisou' },
      { char: '😚', name: 'closed kiss bisou' },
      { char: '😙', name: 'smiling kiss bisou' },
      { char: '🥲', name: 'tear happy larme joie' },
      { char: '😋', name: 'yum miam' },
      { char: '😛', name: 'tongue langue' },
      { char: '😜', name: 'wink tongue clin langue' },
      { char: '🤪', name: 'zany fou' },
      { char: '😝', name: 'squint tongue langue' },
      { char: '🤑', name: 'money argent' },
      { char: '🤗', name: 'hug câlin' },
      { char: '🤭', name: 'hand mouth oups' },
      { char: '🤫', name: 'shush chut' },
      { char: '🤔', name: 'thinking réflexion' },
      { char: '🤐', name: 'zipper silence' },
      { char: '🤨', name: 'raised eyebrow sceptique' },
      { char: '😐', name: 'neutral neutre' },
      { char: '😑', name: 'expressionless impassible' },
      { char: '😶', name: 'no mouth silence' },
      { char: '😏', name: 'smirk malicieux' },
      { char: '😒', name: 'unamused blasé' },
      { char: '🙄', name: 'roll eyes yeux' },
      { char: '😬', name: 'grimace gêné' },
      { char: '🤥', name: 'lying menteur' },
      { char: '😌', name: 'relieved soulagé' },
      { char: '😔', name: 'pensive triste' },
      { char: '😪', name: 'sleepy fatigué' },
      { char: '🤤', name: 'drooling bave' },
      { char: '😴', name: 'sleeping dort' },
      { char: '😷', name: 'mask masque malade' },
      { char: '🤒', name: 'thermometer fièvre malade' },
      { char: '🤕', name: 'bandage blessé' },
      { char: '🤢', name: 'nauseated dégoût' },
      { char: '🤮', name: 'vomit vomi' },
      { char: '🤧', name: 'sneeze éternuer' },
      { char: '🥵', name: 'hot chaud' },
      { char: '🥶', name: 'cold froid' },
      { char: '🥴', name: 'woozy ivre' },
      { char: '😵', name: 'dizzy étourdi' },
      { char: '🤯', name: 'mind blown explosion' },
      { char: '🤠', name: 'cowboy' },
      { char: '🥳', name: 'party fête' },
      { char: '😎', name: 'cool lunettes' },
      { char: '🤓', name: 'nerd geek' },
      { char: '🧐', name: 'monocle sérieux' },
      { char: '😕', name: 'confused confus' },
      { char: '😟', name: 'worried inquiet' },
      { char: '🙁', name: 'slight frown triste' },
      { char: '☹️', name: 'frowning triste' },
      { char: '😮', name: 'open mouth surprise' },
      { char: '😯', name: 'hushed surprise' },
      { char: '😲', name: 'astonished étonné' },
      { char: '😳', name: 'flushed rougi' },
      { char: '🥺', name: 'pleading suppliant' },
      { char: '😦', name: 'frowning open' },
      { char: '😧', name: 'anguished angoissé' },
      { char: '😨', name: 'fearful peur' },
      { char: '😰', name: 'anxious anxieux' },
      { char: '😥', name: 'sad relieved triste' },
      { char: '😢', name: 'cry pleure' },
      { char: '😭', name: 'loudly crying sanglot' },
      { char: '😱', name: 'scream cri peur' },
      { char: '😖', name: 'confounded désarroi' },
      { char: '😣', name: 'persevere persévérant' },
      { char: '😞', name: 'disappointed déçu' },
      { char: '😓', name: 'sweat sueur' },
      { char: '😩', name: 'weary fatigué' },
      { char: '😫', name: 'tired épuisé' },
      { char: '🥱', name: 'yawn bâillement' },
      { char: '😤', name: 'huff colère' },
      { char: '😡', name: 'pout colère' },
      { char: '😠', name: 'angry énervé' },
      { char: '🤬', name: 'swearing insulte' },
      { char: '😈', name: 'smiling devil diable' },
      { char: '👿', name: 'angry devil diable' },
      { char: '💀', name: 'skull mort' },
      { char: '💩', name: 'poop caca' },
      { char: '🤡', name: 'clown' },
      { char: '👻', name: 'ghost fantôme' },
      { char: '👽', name: 'alien extraterrestre' },
      { char: '🤖', name: 'robot' },
    ],
  },
  {
    id: 'gestures',
    label: 'Gestes',
    icon: Hand,
    emojis: [
      { char: '👋', name: 'wave salut bonjour' },
      { char: '🤚', name: 'raised hand main' },
      { char: '✋', name: 'hand stop main' },
      { char: '🖐️', name: 'hand fingers main' },
      { char: '🖖', name: 'vulcan spock' },
      { char: '👌', name: 'ok parfait' },
      { char: '🤌', name: 'pinched italien' },
      { char: '🤏', name: 'pinch petit' },
      { char: '✌️', name: 'victory paix' },
      { char: '🤞', name: 'crossed fingers croisé chance' },
      { char: '🤟', name: 'love you' },
      { char: '🤘', name: 'rock horns' },
      { char: '🤙', name: 'call me' },
      { char: '👈', name: 'point left gauche' },
      { char: '👉', name: 'point right droite' },
      { char: '👆', name: 'point up haut' },
      { char: '👇', name: 'point down bas' },
      { char: '☝️', name: 'index up' },
      { char: '👍', name: 'thumbs up bravo pouce' },
      { char: '👎', name: 'thumbs down pouce bas' },
      { char: '✊', name: 'fist poing' },
      { char: '👊', name: 'punch poing' },
      { char: '🤛', name: 'left fist poing' },
      { char: '🤜', name: 'right fist poing' },
      { char: '👏', name: 'clap applaudir bravo' },
      { char: '🙌', name: 'raising hands hourra' },
      { char: '👐', name: 'open hands câlin' },
      { char: '🤲', name: 'palms up' },
      { char: '🤝', name: 'handshake accord' },
      { char: '🙏', name: 'pray merci s\'il te plaît' },
      { char: '💪', name: 'muscle fort' },
      { char: '🫶', name: 'heart hands coeur mains' },
    ],
  },
  {
    id: 'nature',
    label: 'Animaux et nature',
    icon: Leaf,
    emojis: [
      { char: '🐶', name: 'dog chien' },
      { char: '🐱', name: 'cat chat' },
      { char: '🐭', name: 'mouse souris' },
      { char: '🐹', name: 'hamster' },
      { char: '🐰', name: 'rabbit lapin' },
      { char: '🦊', name: 'fox renard' },
      { char: '🐻', name: 'bear ours' },
      { char: '🐼', name: 'panda' },
      { char: '🐨', name: 'koala' },
      { char: '🐯', name: 'tiger tigre' },
      { char: '🦁', name: 'lion' },
      { char: '🐮', name: 'cow vache' },
      { char: '🐷', name: 'pig cochon' },
      { char: '🐸', name: 'frog grenouille' },
      { char: '🐵', name: 'monkey singe' },
      { char: '🙈', name: 'see no evil singe' },
      { char: '🙉', name: 'hear no evil singe' },
      { char: '🙊', name: 'speak no evil singe' },
      { char: '🐒', name: 'monkey singe' },
      { char: '🐔', name: 'chicken poule' },
      { char: '🐧', name: 'penguin pingouin' },
      { char: '🐦', name: 'bird oiseau' },
      { char: '🐤', name: 'chick poussin' },
      { char: '🦆', name: 'duck canard' },
      { char: '🦅', name: 'eagle aigle' },
      { char: '🦉', name: 'owl hibou' },
      { char: '🦇', name: 'bat chauve-souris' },
      { char: '🐺', name: 'wolf loup' },
      { char: '🐗', name: 'boar sanglier' },
      { char: '🐴', name: 'horse cheval' },
      { char: '🦄', name: 'unicorn licorne' },
      { char: '🐝', name: 'bee abeille' },
      { char: '🪲', name: 'beetle insecte' },
      { char: '🦋', name: 'butterfly papillon' },
      { char: '🐢', name: 'turtle tortue' },
      { char: '🐍', name: 'snake serpent' },
      { char: '🐙', name: 'octopus pieuvre' },
      { char: '🐠', name: 'fish poisson' },
      { char: '🐟', name: 'fish poisson' },
      { char: '🐬', name: 'dolphin dauphin' },
      { char: '🐳', name: 'whale baleine' },
      { char: '🦈', name: 'shark requin' },
      { char: '🐊', name: 'crocodile' },
      { char: '🌵', name: 'cactus' },
      { char: '🌲', name: 'evergreen sapin' },
      { char: '🌳', name: 'tree arbre' },
      { char: '🌴', name: 'palm palmier' },
      { char: '🌱', name: 'seedling plante' },
      { char: '🌿', name: 'herb plante' },
      { char: '☘️', name: 'shamrock trèfle' },
      { char: '🍀', name: 'clover trèfle chance' },
      { char: '🍁', name: 'maple érable' },
      { char: '🍂', name: 'leaves feuilles' },
      { char: '🍃', name: 'leaf vent feuille' },
      { char: '🌷', name: 'tulip tulipe' },
      { char: '🌹', name: 'rose' },
      { char: '🌺', name: 'hibiscus' },
      { char: '🌸', name: 'cherry blossom cerisier' },
      { char: '🌼', name: 'blossom fleur' },
      { char: '🌻', name: 'sunflower tournesol' },
      { char: '🌞', name: 'sun soleil' },
      { char: '🌝', name: 'full moon lune' },
      { char: '🌚', name: 'new moon lune' },
      { char: '🌙', name: 'crescent lune' },
      { char: '⭐', name: 'star étoile' },
      { char: '🌟', name: 'glowing star étoile' },
      { char: '✨', name: 'sparkles étincelles' },
      { char: '⚡', name: 'lightning éclair' },
      { char: '🔥', name: 'fire feu' },
      { char: '💥', name: 'boom explosion' },
      { char: '☀️', name: 'sun soleil' },
      { char: '⛅', name: 'cloud nuage' },
      { char: '☁️', name: 'cloud nuage' },
      { char: '🌧️', name: 'rain pluie' },
      { char: '⛈️', name: 'thunder orage' },
      { char: '🌈', name: 'rainbow arc-en-ciel' },
      { char: '❄️', name: 'snowflake neige' },
      { char: '⛄', name: 'snowman neige' },
      { char: '💧', name: 'water goutte eau' },
      { char: '🌊', name: 'wave vague' },
    ],
  },
  {
    id: 'food',
    label: 'Nourriture et boissons',
    icon: UtensilsCrossed,
    emojis: [
      { char: '🍎', name: 'apple pomme' },
      { char: '🍏', name: 'green apple pomme verte' },
      { char: '🍊', name: 'orange' },
      { char: '🍋', name: 'lemon citron' },
      { char: '🍌', name: 'banana banane' },
      { char: '🍉', name: 'watermelon pastèque' },
      { char: '🍇', name: 'grapes raisin' },
      { char: '🍓', name: 'strawberry fraise' },
      { char: '🫐', name: 'blueberries myrtille' },
      { char: '🍈', name: 'melon' },
      { char: '🍒', name: 'cherries cerises' },
      { char: '🍑', name: 'peach pêche' },
      { char: '🥭', name: 'mango mangue' },
      { char: '🍍', name: 'pineapple ananas' },
      { char: '🥥', name: 'coconut noix coco' },
      { char: '🥝', name: 'kiwi' },
      { char: '🍅', name: 'tomato tomate' },
      { char: '🍆', name: 'eggplant aubergine' },
      { char: '🥑', name: 'avocado avocat' },
      { char: '🥦', name: 'broccoli brocoli' },
      { char: '🥬', name: 'leafy salade' },
      { char: '🥒', name: 'cucumber concombre' },
      { char: '🌶️', name: 'pepper piment' },
      { char: '🌽', name: 'corn maïs' },
      { char: '🥕', name: 'carrot carotte' },
      { char: '🧄', name: 'garlic ail' },
      { char: '🧅', name: 'onion oignon' },
      { char: '🥔', name: 'potato patate' },
      { char: '🍠', name: 'sweet potato patate douce' },
      { char: '🥐', name: 'croissant' },
      { char: '🥖', name: 'baguette' },
      { char: '🍞', name: 'bread pain' },
      { char: '🧀', name: 'cheese fromage' },
      { char: '🥚', name: 'egg oeuf' },
      { char: '🍳', name: 'cooking oeuf poêle' },
      { char: '🥞', name: 'pancakes' },
      { char: '🧇', name: 'waffle gaufre' },
      { char: '🥓', name: 'bacon' },
      { char: '🍔', name: 'burger hamburger' },
      { char: '🍟', name: 'fries frites' },
      { char: '🍕', name: 'pizza' },
      { char: '🌭', name: 'hotdog' },
      { char: '🥪', name: 'sandwich' },
      { char: '🌮', name: 'taco' },
      { char: '🌯', name: 'burrito' },
      { char: '🥙', name: 'stuffed kebab' },
      { char: '🧆', name: 'falafel' },
      { char: '🥗', name: 'salad salade' },
      { char: '🍝', name: 'pasta pâtes' },
      { char: '🍜', name: 'ramen nouilles' },
      { char: '🍲', name: 'stew soupe' },
      { char: '🍛', name: 'curry' },
      { char: '🍣', name: 'sushi' },
      { char: '🍱', name: 'bento' },
      { char: '🥟', name: 'dumpling raviolis' },
      { char: '🍤', name: 'shrimp crevette' },
      { char: '🍰', name: 'cake gâteau' },
      { char: '🎂', name: 'birthday cake gâteau anniversaire' },
      { char: '🧁', name: 'cupcake' },
      { char: '🍪', name: 'cookie biscuit' },
      { char: '🍫', name: 'chocolate chocolat' },
      { char: '🍬', name: 'candy bonbon' },
      { char: '🍭', name: 'lollipop sucette' },
      { char: '🍮', name: 'custard flan' },
      { char: '🍯', name: 'honey miel' },
      { char: '🍿', name: 'popcorn' },
      { char: '🥤', name: 'cup boisson' },
      { char: '☕', name: 'coffee café' },
      { char: '🍵', name: 'tea thé' },
      { char: '🧃', name: 'juice jus' },
      { char: '🧉', name: 'mate' },
      { char: '🧋', name: 'bubble tea' },
      { char: '🍺', name: 'beer bière' },
      { char: '🍻', name: 'beers bières santé' },
      { char: '🥂', name: 'cheers santé' },
      { char: '🍷', name: 'wine vin' },
      { char: '🥃', name: 'whisky' },
      { char: '🍸', name: 'cocktail' },
      { char: '🍹', name: 'tropical cocktail' },
      { char: '🍾', name: 'champagne bouteille' },
    ],
  },
  {
    id: 'travel',
    label: 'Voyages',
    icon: Plane,
    emojis: [
      { char: '🚗', name: 'car voiture' },
      { char: '🚕', name: 'taxi' },
      { char: '🚙', name: 'suv voiture' },
      { char: '🚌', name: 'bus' },
      { char: '🚎', name: 'trolleybus' },
      { char: '🏎️', name: 'race car formule 1' },
      { char: '🚓', name: 'police voiture' },
      { char: '🚑', name: 'ambulance' },
      { char: '🚒', name: 'fire truck pompier' },
      { char: '🚐', name: 'minivan' },
      { char: '🚚', name: 'truck camion' },
      { char: '🚛', name: 'lorry camion' },
      { char: '🚜', name: 'tractor tracteur' },
      { char: '🛵', name: 'scooter' },
      { char: '🏍️', name: 'motorcycle moto' },
      { char: '🚲', name: 'bicycle vélo' },
      { char: '🛴', name: 'kick scooter trottinette' },
      { char: '🛹', name: 'skateboard' },
      { char: '🚨', name: 'police light gyrophare' },
      { char: '🚔', name: 'police car voiture' },
      { char: '🚍', name: 'bus' },
      { char: '🚖', name: 'taxi' },
      { char: '🚘', name: 'car voiture' },
      { char: '🚅', name: 'bullet train tgv' },
      { char: '🚄', name: 'train' },
      { char: '🚂', name: 'locomotive' },
      { char: '🚆', name: 'train' },
      { char: '🚇', name: 'metro métro' },
      { char: '🚊', name: 'tram' },
      { char: '🚉', name: 'station gare' },
      { char: '✈️', name: 'plane avion' },
      { char: '🛫', name: 'takeoff décollage' },
      { char: '🛬', name: 'landing atterrissage' },
      { char: '🛩️', name: 'small plane avion' },
      { char: '🚁', name: 'helicopter hélicoptère' },
      { char: '🚀', name: 'rocket fusée' },
      { char: '🛸', name: 'ufo ovni' },
      { char: '⛵', name: 'boat voilier' },
      { char: '🚤', name: 'speedboat bateau' },
      { char: '🛥️', name: 'motor boat bateau' },
      { char: '🛳️', name: 'cruise ship croisière' },
      { char: '⛴️', name: 'ferry' },
      { char: '🚢', name: 'ship bateau' },
      { char: '⚓', name: 'anchor ancre' },
      { char: '🗺️', name: 'map carte' },
      { char: '🗽', name: 'liberty statue' },
      { char: '🗼', name: 'tokyo tower' },
      { char: '🏰', name: 'castle château' },
      { char: '🏯', name: 'japanese castle' },
      { char: '🗻', name: 'mount fuji montagne' },
      { char: '🏔️', name: 'mountain montagne' },
      { char: '⛰️', name: 'mountain montagne' },
      { char: '🌋', name: 'volcano volcan' },
      { char: '🏖️', name: 'beach plage' },
      { char: '🏜️', name: 'desert désert' },
      { char: '🏝️', name: 'island île' },
      { char: '🏕️', name: 'camping tente' },
      { char: '🌅', name: 'sunrise lever soleil' },
      { char: '🌆', name: 'cityscape ville' },
      { char: '🌇', name: 'sunset coucher' },
      { char: '🌃', name: 'night nuit' },
      { char: '🌉', name: 'bridge pont' },
      { char: '🎡', name: 'ferris wheel grande roue' },
      { char: '🎢', name: 'roller coaster' },
      { char: '🎠', name: 'carousel carrousel' },
    ],
  },
  {
    id: 'activities',
    label: 'Activités',
    icon: Gamepad2,
    emojis: [
      { char: '⚽', name: 'soccer football' },
      { char: '🏀', name: 'basketball' },
      { char: '🏈', name: 'football américain' },
      { char: '⚾', name: 'baseball' },
      { char: '🥎', name: 'softball' },
      { char: '🎾', name: 'tennis' },
      { char: '🏐', name: 'volleyball' },
      { char: '🏉', name: 'rugby' },
      { char: '🎱', name: 'billard pool' },
      { char: '🏓', name: 'ping pong tennis table' },
      { char: '🏸', name: 'badminton' },
      { char: '🥅', name: 'goal but' },
      { char: '🏒', name: 'hockey glace' },
      { char: '🏑', name: 'hockey gazon' },
      { char: '🥍', name: 'lacrosse' },
      { char: '🏏', name: 'cricket' },
      { char: '⛳', name: 'golf' },
      { char: '🏹', name: 'bow arrow arc' },
      { char: '🎣', name: 'fishing pêche' },
      { char: '🥊', name: 'boxing boxe' },
      { char: '🥋', name: 'martial arts' },
      { char: '⛸️', name: 'ice skate patinage' },
      { char: '🥌', name: 'curling' },
      { char: '🎿', name: 'ski' },
      { char: '⛷️', name: 'skier ski' },
      { char: '🏂', name: 'snowboard' },
      { char: '🏋️', name: 'weight lifting musculation' },
      { char: '🤼', name: 'wrestling lutte' },
      { char: '🤸', name: 'cartwheel gym' },
      { char: '🤺', name: 'fencing escrime' },
      { char: '🤾', name: 'handball' },
      { char: '🏌️', name: 'golfing golf' },
      { char: '🏇', name: 'horse racing' },
      { char: '🧘', name: 'yoga' },
      { char: '🏄', name: 'surfing surf' },
      { char: '🚣', name: 'rowing aviron' },
      { char: '🏊', name: 'swim natation' },
      { char: '🤽', name: 'water polo' },
      { char: '🚴', name: 'cycling vélo' },
      { char: '🚵', name: 'mountain bike vtt' },
      { char: '🎖️', name: 'medal médaille' },
      { char: '🏅', name: 'medal médaille' },
      { char: '🥇', name: 'gold or médaille' },
      { char: '🥈', name: 'silver argent médaille' },
      { char: '🥉', name: 'bronze médaille' },
      { char: '🏆', name: 'trophy trophée' },
      { char: '🎗️', name: 'ribbon ruban' },
      { char: '🎫', name: 'ticket billet' },
      { char: '🎟️', name: 'admission billet' },
      { char: '🎪', name: 'circus tent cirque' },
      { char: '🎭', name: 'theater théâtre' },
      { char: '🎨', name: 'art peinture' },
      { char: '🎬', name: 'clapper film cinéma' },
      { char: '🎤', name: 'microphone micro' },
      { char: '🎧', name: 'headphones casque' },
      { char: '🎼', name: 'music sheet partition' },
      { char: '🎵', name: 'music note musique' },
      { char: '🎶', name: 'notes musique' },
      { char: '🎹', name: 'piano' },
      { char: '🥁', name: 'drum batterie tambour' },
      { char: '🎸', name: 'guitar guitare' },
      { char: '🎺', name: 'trumpet trompette' },
      { char: '🎷', name: 'saxophone' },
      { char: '🎻', name: 'violin violon' },
      { char: '🎲', name: 'dice dé jeu' },
      { char: '🎯', name: 'target cible fléchette' },
      { char: '🎳', name: 'bowling' },
      { char: '🎮', name: 'video game jeu vidéo' },
      { char: '🕹️', name: 'joystick' },
      { char: '🎰', name: 'slot machine' },
      { char: '🧩', name: 'puzzle' },
    ],
  },
  {
    id: 'objects',
    label: 'Objets',
    icon: Lightbulb,
    emojis: [
      { char: '💡', name: 'lightbulb idée' },
      { char: '🔦', name: 'flashlight lampe' },
      { char: '🕯️', name: 'candle bougie' },
      { char: '🧯', name: 'extinguisher extincteur' },
      { char: '🛢️', name: 'oil drum baril' },
      { char: '💸', name: 'money envolé argent' },
      { char: '💵', name: 'dollar argent' },
      { char: '💴', name: 'yen' },
      { char: '💶', name: 'euro' },
      { char: '💷', name: 'pound livre' },
      { char: '💰', name: 'money bag sac argent' },
      { char: '💳', name: 'credit card carte' },
      { char: '💎', name: 'diamond diamant' },
      { char: '⚖️', name: 'balance scale' },
      { char: '🔧', name: 'wrench clé' },
      { char: '🔨', name: 'hammer marteau' },
      { char: '⚒️', name: 'hammer pick outils' },
      { char: '🛠️', name: 'tools outils' },
      { char: '⛏️', name: 'pick pioche' },
      { char: '🔩', name: 'nut bolt boulon' },
      { char: '⚙️', name: 'gear engrenage' },
      { char: '🧰', name: 'toolbox boîte outils' },
      { char: '🧲', name: 'magnet aimant' },
      { char: '💼', name: 'briefcase mallette travail' },
      { char: '📁', name: 'folder dossier' },
      { char: '📂', name: 'open folder dossier ouvert' },
      { char: '🗂️', name: 'dividers dossiers' },
      { char: '📅', name: 'calendar calendrier' },
      { char: '📆', name: 'tear calendar' },
      { char: '🗓️', name: 'spiral calendar calendrier' },
      { char: '📇', name: 'card index rolodex' },
      { char: '📈', name: 'chart up graphique hausse' },
      { char: '📉', name: 'chart down graphique baisse' },
      { char: '📊', name: 'bar chart barre graphique' },
      { char: '📋', name: 'clipboard presse-papier' },
      { char: '📌', name: 'pushpin punaise' },
      { char: '📍', name: 'round pushpin épingle' },
      { char: '📎', name: 'paperclip trombone' },
      { char: '🖇️', name: 'linked paperclips trombones' },
      { char: '📏', name: 'ruler règle' },
      { char: '📐', name: 'triangle ruler équerre' },
      { char: '✂️', name: 'scissors ciseaux' },
      { char: '🗃️', name: 'card file box boîte' },
      { char: '🗄️', name: 'file cabinet classeur' },
      { char: '🗑️', name: 'wastebasket poubelle' },
      { char: '🔒', name: 'lock cadenas fermé' },
      { char: '🔓', name: 'unlock cadenas ouvert' },
      { char: '🔑', name: 'key clé' },
      { char: '🗝️', name: 'old key clé' },
      { char: '💻', name: 'laptop ordinateur portable' },
      { char: '🖥️', name: 'desktop ordinateur' },
      { char: '🖨️', name: 'printer imprimante' },
      { char: '⌨️', name: 'keyboard clavier' },
      { char: '🖱️', name: 'mouse souris' },
      { char: '📱', name: 'phone téléphone mobile' },
      { char: '☎️', name: 'phone téléphone' },
      { char: '📞', name: 'receiver téléphone' },
      { char: '📟', name: 'pager bipeur' },
      { char: '📠', name: 'fax' },
      { char: '📺', name: 'tv télévision' },
      { char: '📻', name: 'radio' },
      { char: '🎙️', name: 'studio mic micro' },
      { char: '🧭', name: 'compass boussole' },
      { char: '⏰', name: 'alarm réveil' },
      { char: '⏱️', name: 'stopwatch chrono' },
      { char: '⌚', name: 'watch montre' },
      { char: '📡', name: 'satellite satellite' },
      { char: '🔋', name: 'battery batterie' },
      { char: '🔌', name: 'plug prise' },
      { char: '💊', name: 'pill pilule' },
      { char: '💉', name: 'syringe seringue' },
      { char: '🩹', name: 'bandage pansement' },
      { char: '🩺', name: 'stethoscope' },
      { char: '📖', name: 'book livre ouvert' },
      { char: '📚', name: 'books livres' },
      { char: '📝', name: 'memo note crayon' },
      { char: '✏️', name: 'pencil crayon' },
      { char: '✒️', name: 'nib stylo' },
      { char: '🖊️', name: 'pen stylo' },
      { char: '🖋️', name: 'fountain pen stylo plume' },
      { char: '📧', name: 'email mail courriel' },
      { char: '📨', name: 'incoming email' },
      { char: '📩', name: 'outgoing email' },
      { char: '📪', name: 'closed mailbox boîte aux lettres' },
      { char: '📫', name: 'mailbox boîte aux lettres' },
      { char: '📬', name: 'mailbox boîte aux lettres' },
      { char: '📭', name: 'mailbox boîte aux lettres' },
      { char: '📮', name: 'postbox boîte lettres' },
    ],
  },
  {
    id: 'symbols',
    label: 'Symboles',
    icon: Heart,
    emojis: [
      { char: '❤️', name: 'red heart coeur rouge' },
      { char: '🧡', name: 'orange heart coeur orange' },
      { char: '💛', name: 'yellow heart coeur jaune' },
      { char: '💚', name: 'green heart coeur vert' },
      { char: '💙', name: 'blue heart coeur bleu' },
      { char: '💜', name: 'purple heart coeur violet' },
      { char: '🖤', name: 'black heart coeur noir' },
      { char: '🤍', name: 'white heart coeur blanc' },
      { char: '🤎', name: 'brown heart coeur marron' },
      { char: '💔', name: 'broken heart coeur brisé' },
      { char: '❣️', name: 'heart exclamation coeur' },
      { char: '💕', name: 'two hearts coeurs' },
      { char: '💞', name: 'revolving hearts coeurs' },
      { char: '💓', name: 'beating heart coeur' },
      { char: '💗', name: 'growing heart coeur' },
      { char: '💖', name: 'sparkling heart coeur' },
      { char: '💘', name: 'arrow heart coeur flèche' },
      { char: '💝', name: 'heart ribbon coeur' },
      { char: '💟', name: 'heart decoration coeur' },
      { char: '☮️', name: 'peace paix' },
      { char: '✝️', name: 'cross croix' },
      { char: '☪️', name: 'star crescent étoile croissant' },
      { char: '🕉️', name: 'om' },
      { char: '☸️', name: 'dharma' },
      { char: '✡️', name: 'star david étoile' },
      { char: '🔯', name: 'six pointed star étoile' },
      { char: '🕎', name: 'menorah' },
      { char: '☯️', name: 'yin yang' },
      { char: '☦️', name: 'orthodox cross croix' },
      { char: '🛐', name: 'worship prière' },
      { char: '⚛️', name: 'atom atome' },
      { char: '♈', name: 'aries bélier' },
      { char: '♉', name: 'taurus taureau' },
      { char: '♊', name: 'gemini gémeaux' },
      { char: '♋', name: 'cancer' },
      { char: '♌', name: 'leo lion' },
      { char: '♍', name: 'virgo vierge' },
      { char: '♎', name: 'libra balance' },
      { char: '♏', name: 'scorpio scorpion' },
      { char: '♐', name: 'sagittarius sagittaire' },
      { char: '♑', name: 'capricorn capricorne' },
      { char: '♒', name: 'aquarius verseau' },
      { char: '♓', name: 'pisces poissons' },
      { char: '⛎', name: 'ophiuchus' },
      { char: '🆔', name: 'id' },
      { char: '⚠️', name: 'warning attention danger' },
      { char: '🚸', name: 'children crossing enfants' },
      { char: '⛔', name: 'no entry stop interdit' },
      { char: '🚫', name: 'prohibited interdit' },
      { char: '🚭', name: 'no smoking interdit' },
      { char: '❗', name: 'exclamation point' },
      { char: '❓', name: 'question' },
      { char: '❕', name: 'white exclamation' },
      { char: '❔', name: 'white question' },
      { char: '‼️', name: 'double exclamation' },
      { char: '⁉️', name: 'exclamation question' },
      { char: '💯', name: '100 cent' },
      { char: '🔝', name: 'top haut' },
      { char: '🔙', name: 'back retour' },
      { char: '🔛', name: 'on' },
      { char: '🔜', name: 'soon bientôt' },
      { char: '🔚', name: 'end fin' },
      { char: '✅', name: 'check coche valide' },
      { char: '☑️', name: 'checkbox case cochée' },
      { char: '✔️', name: 'check coche' },
      { char: '❌', name: 'cross croix erreur' },
      { char: '❎', name: 'cross mark' },
      { char: '➕', name: 'plus ajouter' },
      { char: '➖', name: 'minus moins' },
      { char: '➗', name: 'divide division' },
      { char: '✖️', name: 'multiply multiplication' },
      { char: '➰', name: 'curly loop' },
      { char: '➿', name: 'double loop' },
      { char: '〽️', name: 'part alternation' },
      { char: '🔀', name: 'shuffle aléatoire' },
      { char: '🔁', name: 'repeat répéter' },
      { char: '🔂', name: 'repeat one' },
      { char: '▶️', name: 'play lecture' },
      { char: '⏸️', name: 'pause' },
      { char: '⏹️', name: 'stop' },
      { char: '⏺️', name: 'record enregistrer' },
      { char: '⏭️', name: 'next suivant' },
      { char: '⏮️', name: 'previous précédent' },
      { char: '⏩', name: 'fast forward avance rapide' },
      { char: '⏪', name: 'rewind retour rapide' },
      { char: '🔊', name: 'speaker volume' },
      { char: '🔉', name: 'speaker medium' },
      { char: '🔈', name: 'speaker low' },
      { char: '🔇', name: 'muted muet' },
      { char: '🔔', name: 'bell cloche' },
      { char: '🔕', name: 'muted bell' },
      { char: '📢', name: 'loudspeaker haut-parleur' },
      { char: '📣', name: 'megaphone' },
    ],
  },
];

const FLAT = CATEGORIES.flatMap(c => c.emojis.map(e => ({ ...e, category: c.id })));
const RECENT_KEY = 'emoji-panel-recent';

function loadRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter(v => typeof v === 'string').slice(0, 32);
  } catch { /* ignore */ }
  return [];
}

function saveRecent(emojis: string[]) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(emojis.slice(0, 32)));
  } catch { /* ignore */ }
}

export default function EmojiPanel({ open, onClose, onSelect }: EmojiPanelProps) {
  const [query, setQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<string>(CATEGORIES[0].id);
  const [recent, setRecent] = useState<string[]>(() => loadRecent());
  const searchInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      // Keep editor focused so insertion lands at caret — do not autofocus search.
    }
  }, [open]);

  const handlePick = (emoji: string) => {
    onSelect(emoji);
    setRecent(prev => {
      const next = [emoji, ...prev.filter(e => e !== emoji)].slice(0, 32);
      saveRecent(next);
      return next;
    });
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    return FLAT.filter(e => e.name.includes(q) || e.char.includes(q)).slice(0, 200);
  }, [query]);

  const scrollToCategory = (id: string) => {
    setActiveCategory(id);
    const el = scrollRef.current?.querySelector(`[data-category="${id}"]`) as HTMLElement | null;
    if (el && scrollRef.current) {
      scrollRef.current.scrollTo({ top: el.offsetTop - 8, behavior: 'smooth' });
    }
  };

  if (!open) return null;

  return (
    <aside
      className="flex-shrink-0 w-80 h-full bg-white rounded-md shadow-sm overflow-hidden flex flex-col border border-outlook-border"
      aria-label="Panneau d'emojis"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-outlook-border">
        <h3 className="text-sm font-semibold text-outlook-text-primary">Expressions</h3>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-outlook-bg-hover text-outlook-text-secondary"
          title="Fermer"
        >
          <X size={16} />
        </button>
      </div>

      {/* Search */}
      <div className="px-3 py-2 border-b border-outlook-border">
        <div className="relative">
          <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-outlook-text-disabled pointer-events-none" />
          <input
            ref={searchInputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher des emojis"
            className="w-full text-xs pl-7 pr-2 py-1.5 bg-outlook-bg-tertiary rounded border border-transparent focus:bg-white focus:border-outlook-blue outline-none"
          />
        </div>
      </div>

      {/* Category tabs */}
      {!filtered && (
        <div className="flex items-center gap-0.5 px-2 py-1 border-b border-outlook-border overflow-x-auto flex-shrink-0">
          {CATEGORIES.map(cat => {
            const Icon = cat.icon;
            const active = activeCategory === cat.id;
            return (
              <button
                key={cat.id}
                onClick={() => scrollToCategory(cat.id)}
                className={`flex-shrink-0 p-1.5 rounded transition-colors ${
                  active
                    ? 'bg-outlook-blue/10 text-outlook-blue'
                    : 'text-outlook-text-secondary hover:bg-outlook-bg-hover'
                }`}
                title={cat.label}
              >
                <Icon size={16} />
              </button>
            );
          })}
        </div>
      )}

      {/* Content */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-2">
        {filtered ? (
          filtered.length > 0 ? (
            <div className="grid grid-cols-8 gap-0.5">
              {filtered.map((e, i) => (
                <button
                  key={`${e.char}-${i}`}
                  onMouseDown={(ev) => { ev.preventDefault(); handlePick(e.char); }}
                  className="w-8 h-8 flex items-center justify-center text-xl rounded hover:bg-outlook-bg-hover"
                  title={e.name}
                >
                  {e.char}
                </button>
              ))}
            </div>
          ) : (
            <div className="text-xs text-outlook-text-secondary text-center py-8">
              Aucun emoji trouvé
            </div>
          )
        ) : (
          <>
            {recent.length > 0 && (
              <section className="mb-3">
                <h4 className="text-[11px] font-semibold text-outlook-text-secondary uppercase tracking-wide px-1 mb-1">
                  Récents
                </h4>
                <div className="grid grid-cols-8 gap-0.5">
                  {recent.map((char, i) => (
                    <button
                      key={`recent-${char}-${i}`}
                      onMouseDown={(ev) => { ev.preventDefault(); handlePick(char); }}
                      className="w-8 h-8 flex items-center justify-center text-xl rounded hover:bg-outlook-bg-hover"
                    >
                      {char}
                    </button>
                  ))}
                </div>
              </section>
            )}
            {CATEGORIES.map(cat => (
              <section key={cat.id} data-category={cat.id} className="mb-3">
                <h4 className="text-[11px] font-semibold text-outlook-text-secondary uppercase tracking-wide px-1 mb-1">
                  {cat.label}
                </h4>
                <div className="grid grid-cols-8 gap-0.5">
                  {cat.emojis.map((e, i) => (
                    <button
                      key={`${cat.id}-${i}`}
                      onMouseDown={(ev) => { ev.preventDefault(); handlePick(e.char); }}
                      className="w-8 h-8 flex items-center justify-center text-xl rounded hover:bg-outlook-bg-hover"
                      title={e.name}
                    >
                      {e.char}
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </>
        )}
      </div>
    </aside>
  );
}
