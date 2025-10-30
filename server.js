require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
  origin: "*", // or use your Next.js domain in production
  methods: ["GET", "POST", "PUT", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));
app.use(express.json());

// MySQL Connection Pool
const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Test connection on startup
async function testConnection() {
    try {
        const connection = await pool.getConnection();
        console.log('MySQL connected successfully');
        connection.release();
    } catch (err) {
        console.error('MySQL connection failed:', err);
    }
}
testConnection();

// Utility function to get week start date (Monday) from a given date
function getWeekStart(dateStr) {
    const date = new Date(dateStr);
    const day = date.getDay(); // 0=Sun, 1=Mon, ...
    const diff = date.getDate() - day + (day === 0 ? -6 : 1); // Adjust to Monday
    const weekStart = new Date(date);
    weekStart.setDate(diff);
    return weekStart.toISOString().split('T')[0];
}

// POST /api/horoscopes - Insert/Update horoscope(s) for a sign and date
// Supports inserting daily, weekly, or both based on provided fields
app.post('/api/horoscopes', async (req, res) => {
    const { sign_id, sign_name, symbol, daily_horoscope, weekly_horoscope, horoscope_date } = req.body;
    
    if (!sign_id || !sign_name || !symbol || !horoscope_date) {
        return res.status(400).json({ error: 'Missing required fields (sign_id, sign_name, symbol, horoscope_date)' });
    }

    const daily = daily_horoscope || '';
    const weekly = weekly_horoscope || '';
    let results = {};

    try {
        // Insert/Update daily if provided
        if (daily) {
            const [dailyResult] = await pool.execute(
                `INSERT INTO daily_horoscopes (sign_id, sign_name, symbol, daily_horoscope, horoscope_date)
                 VALUES (?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE
                 daily_horoscope = VALUES(daily_horoscope),
                 sign_name = VALUES(sign_name),
                 symbol = VALUES(symbol)`,
                [sign_id, sign_name, symbol, daily, horoscope_date]
            );
            results.daily = { message: 'Daily horoscope inserted/updated successfully', insertId: dailyResult.insertId };
        }

        // Insert/Update weekly if provided
        if (weekly) {
            const weekStart = getWeekStart(horoscope_date);
            const [weeklyResult] = await pool.execute(
                `INSERT INTO weekly_horoscopes (sign_id, sign_name, symbol, weekly_horoscope, week_start_date)
                 VALUES (?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE
                 weekly_horoscope = VALUES(weekly_horoscope),
                 sign_name = VALUES(sign_name),
                 symbol = VALUES(symbol)`,
                [sign_id, sign_name, symbol, weekly, weekStart]
            );
            results.weekly = { message: 'Weekly horoscope inserted/updated successfully', insertId: weeklyResult.insertId };
        }

        res.json({ message: 'Horoscope(s) inserted/updated successfully', results });
    } catch (err) {
        console.error('Insert error:', err);
        res.status(500).json({ error: 'Database insert failed' });
    }
});

// GET /api/horoscopes/:signId?date=YYYY-MM-DD&type=daily|weekly - Fetch horoscope for a sign and date/type (optional date defaults to today)
app.get('/api/horoscopes/:signId', async (req, res) => {
    const signId = req.params.signId;
    const date = req.query.date || new Date().toISOString().split('T')[0];
    const type = req.query.type || 'daily';

    let queryDate = date;
    let table = 'daily_horoscopes';
    let dateField = 'horoscope_date';
    let horoscopeField = 'daily_horoscope';
    let otherField = `'' as weekly_horoscope`;

    if (type === 'weekly') {
        queryDate = getWeekStart(date);
        table = 'weekly_horoscopes';
        dateField = 'week_start_date';
        horoscopeField = 'weekly_horoscope';
        otherField = `'' as daily_horoscope`;
    }

    try {
        const [rows] = await pool.execute(
            `SELECT sign_id as id, sign_name, symbol, ${horoscopeField}, ${otherField}, ${dateField} as horoscope_date 
             FROM ${table} 
             WHERE sign_id = ? AND ${dateField} = ?`,
            [signId, queryDate]
        );
        if (rows.length === 0) {
            return res.status(404).json({ error: 'Sign not found for this date/type' });
        }
        res.json(rows[0]);
    } catch (err) {
        console.error('Fetch error:', err);
        res.status(500).json({ error: 'Database fetch failed' });
    }
});

// GET /api/horoscopes?date=YYYY-MM-DD&type=daily|weekly - Fetch all horoscopes for the date/type (optional date defaults to today)
app.get('/api/horoscopes', async (req, res) => {
    const date = req.query.date || new Date().toISOString().split('T')[0];
    const type = req.query.type || 'daily';

    let queryDate = date;
    let table = 'daily_horoscopes';
    let dateField = 'horoscope_date';
    let horoscopeField = 'daily_horoscope';
    let otherField = `'' as weekly_horoscope`;

    if (type === 'weekly') {
        queryDate = getWeekStart(date);
        table = 'weekly_horoscopes';
        dateField = 'week_start_date';
        horoscopeField = 'weekly_horoscope';
        otherField = `'' as daily_horoscope`;
    }

    try {
        const [rows] = await pool.execute(
            `SELECT sign_id as id, sign_name, symbol, ${horoscopeField}, ${otherField}, ${dateField} as horoscope_date 
             FROM ${table} 
             WHERE ${dateField} = ? 
             ORDER BY sign_id`,
            [queryDate]
        );
        res.json(rows);
    } catch (err) {
        console.error('Fetch all error:', err);
        res.status(500).json({ error: 'Database fetch failed' });
    }
});

// Start server
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
