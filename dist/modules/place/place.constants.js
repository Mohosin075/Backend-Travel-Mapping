"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.difficultyMap = exports.placeDifficulty = exports.placeSearchableFields = void 0;
exports.placeSearchableFields = ['name', 'address', 'location.address', 'location.city', 'location.state', 'location.municipality', 'location.region', 'location.town', 'country']; // category name is matched separately
exports.placeDifficulty = [
    'Easy',
    'Moderate',
    'Hard',
    'Fácil',
    'Facil',
    'Moderado',
    'Difícil',
    'Dificil',
];
exports.difficultyMap = {
    Easy: { en: 'Easy', es: 'Fácil' },
    Moderate: { en: 'Moderate', es: 'Moderado' },
    Hard: { en: 'Hard', es: 'Difícil' },
    Fácil: { en: 'Easy', es: 'Fácil' },
    Facil: { en: 'Easy', es: 'Fácil' },
    Moderado: { en: 'Moderate', es: 'Moderado' },
    Difícil: { en: 'Hard', es: 'Difícil' },
    Dificil: { en: 'Hard', es: 'Difícil' },
};
