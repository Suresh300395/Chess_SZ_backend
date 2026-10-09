module.exports = {
    MEAL_TYPES: ['Breakfast', 'Lunch', 'Snacks', 'Dinner'],
    ORGANIZATION_NAME: 'Aditya University',
    EVENT_NAME: 'South Zone Inter-University Chess Tournament',
    DEFAULT_PAPER_WIDTH: '80mm',
    // Helper to get local date string YYYY-MM-DD
    getTodayString: () => {
        const d = new Date();
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }
};
