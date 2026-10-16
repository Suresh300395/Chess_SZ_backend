const MEAL_TYPES = ['Breakfast', 'Lunch', 'Dinner'];
const ORGANIZATION_NAME = 'Aditya University';
const EVENT_NAME = 'South Zone Inter-University Chess Tournament';
const DEFAULT_PAPER_WIDTH = '80mm';

// Expiration cutoff times for each meal
// Breakfast: 10:00 AM
// Lunch: 2:00 PM (14:00)
// Dinner: 9:00 PM (21:00)
const MEAL_EXPIRY_TIMES = {
    'Breakfast': { hour: 11, minute: 0, label: '11:00 AM' },
    'Lunch': { hour: 15, minute: 0, label: '3:00 PM' },
    'Dinner': { hour: 22, minute: 0, label: '10:00 PM' }
};

/**
 * Parses mealDate string and mealType into an exact local Date object representing expiration cutoff.
 * Handles YYYY-MM-DD, DD-MM-YYYY, DD/MM/YYYY, ISO strings.
 */
const parseMealExpiryDateTime = (mealDateStr, mealType) => {
    if (!mealDateStr || typeof mealDateStr !== 'string') return null;
    const trimmed = mealDateStr.trim();
    let y, m, d;

    if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
        const datePart = trimmed.split('T')[0];
        const parts = datePart.split('-');
        y = parseInt(parts[0], 10);
        m = parseInt(parts[1], 10) - 1;
        d = parseInt(parts[2], 10);
    } else if (/^\d{2}[-/]\d{2}[-/]\d{4}/.test(trimmed)) {
        const datePart = trimmed.split('T')[0];
        const parts = datePart.split(/[-/]/);
        d = parseInt(parts[0], 10);
        m = parseInt(parts[1], 10) - 1;
        y = parseInt(parts[2], 10);
    } else {
        const dt = new Date(trimmed);
        if (isNaN(dt.getTime())) return null;
        y = dt.getFullYear();
        m = dt.getMonth();
        d = dt.getDate();
    }

    const typeLower = (mealType || '').trim().toLowerCase();
    const cutoff = typeLower.includes('breakfast') ? { hour: 11, minute: 0 }
        : typeLower.includes('lunch') ? { hour: 15, minute: 0 }
            : typeLower.includes('dinner') ? { hour: 22, minute: 0 }
                : { hour: 23, minute: 59 };

    return new Date(y, m, d, cutoff.hour, cutoff.minute, 0, 0);
};

/**
 * Checks if a meal token has expired based on its mealDate and mealType cutoff time.
 */
const isMealTokenExpired = (mealDateStr, mealType) => {
    const expiry = parseMealExpiryDateTime(mealDateStr, mealType);
    if (!expiry) return false;
    return Date.now() > expiry.getTime();
};

/**
 * Helper to get local date string YYYY-MM-DD
 */
const getTodayString = () => {
    const dt = new Date();
    const year = dt.getFullYear();
    const month = String(dt.getMonth() + 1).padStart(2, '0');
    const day = String(dt.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

module.exports = {
    MEAL_TYPES,
    ORGANIZATION_NAME,
    EVENT_NAME,
    DEFAULT_PAPER_WIDTH,
    MEAL_EXPIRY_TIMES,
    parseMealExpiryDateTime,
    isMealTokenExpired,
    getTodayString
};
