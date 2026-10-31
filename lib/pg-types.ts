// postgres.js type overrides shared by the app client, the seed and the scripts, so every client sees the same shapes.
// Business dates (`date` columns) stay "yyyy-mm-dd" strings: turning them into JS Dates would pin them to UTC midnight
// and shift them a day in US time zones. timestamptz still maps to Date.
export const PG_TYPES = {
  plainDate: { to: 1082, from: [1082], serialize: (x: string) => x, parse: (x: string) => x },
};
