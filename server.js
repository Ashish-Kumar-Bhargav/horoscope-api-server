require('dotenv').config();
const express = require('express');
const { MongoClient } = require('mongodb');
const cors = require('cors');
const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "PUT", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));
app.use(express.json());

// MongoDB Connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://root:Shubu%40123@testing.rdqvgba.mongodb.net/astrologer';
const client = new MongoClient(MONGODB_URI);

let db;
let dailyCollection;
let weeklyCollection;

// Connect to MongoDB
async function connectDB() {
    try {
        await client.connect();
        console.log('MongoDB connected successfully');
        
        db = client.db('astrologer');
        dailyCollection = db.collection('daily_horoscopes');
        weeklyCollection = db.collection('weekly_horoscopes');
        
        // Create indexes for better query performance
        await dailyCollection.createIndex({ sign_id: 1, horoscope_date: 1 }, { unique: true });
        await weeklyCollection.createIndex({ sign_id: 1, week_start_date: 1 }, { unique: true });
        
        console.log('MongoDB indexes created');
    } catch (err) {
        console.error('MongoDB connection failed:', err);
        process.exit(1);
    }
}

connectDB();

// Graceful shutdown
process.on('SIGINT', async () => {
    await client.close();
    console.log('MongoDB connection closed');
    process.exit(0);
});

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
            const dailyResult = await dailyCollection.updateOne(
                { sign_id, horoscope_date },
                {
                    $set: {
                        sign_name,
                        symbol,
                        daily_horoscope: daily,
                        horoscope_date
                    }
                },
                { upsert: true }
            );
            results.daily = { 
                message: 'Daily horoscope inserted/updated successfully', 
                insertId: dailyResult.upsertedId || 'updated'
            };
        }

        // Insert/Update weekly if provided
        if (weekly) {
            const weekStart = getWeekStart(horoscope_date);
            const weeklyResult = await weeklyCollection.updateOne(
                { sign_id, week_start_date: weekStart },
                {
                    $set: {
                        sign_name,
                        symbol,
                        weekly_horoscope: weekly,
                        week_start_date: weekStart
                    }
                },
                { upsert: true }
            );
            results.weekly = { 
                message: 'Weekly horoscope inserted/updated successfully', 
                insertId: weeklyResult.upsertedId || 'updated'
            };
        }

        res.json({ message: 'Horoscope(s) inserted/updated successfully', results });
    } catch (err) {
        console.error('Insert error:', err);
        res.status(500).json({ error: 'Database insert failed' });
    }
});

// GET /api/horoscopes/:signId?date=YYYY-MM-DD&type=daily|weekly - Fetch horoscope for a sign and date/type (optional date defaults to today)
app.get('/api/horoscopes/:signId', async (req, res) => {
    const signId = parseInt(req.params.signId);
    const date = req.query.date || new Date().toISOString().split('T')[0];
    const type = req.query.type || 'daily';

    let queryDate = date;
    let collection = dailyCollection;
    let dateField = 'horoscope_date';

    if (type === 'weekly') {
        queryDate = getWeekStart(date);
        collection = weeklyCollection;
        dateField = 'week_start_date';
    }

    try {
        const query = { sign_id: signId };
        query[dateField] = queryDate;

        const result = await collection.findOne(query, {
            projection: { _id: 0 }
        });

        if (!result) {
            return res.status(404).json({ error: 'Sign not found for this date/type' });
        }

        // Format response to match MySQL structure
        const response = {
            id: result.sign_id,
            sign_name: result.sign_name,
            symbol: result.symbol,
            daily_horoscope: result.daily_horoscope || '',
            weekly_horoscope: result.weekly_horoscope || '',
            horoscope_date: result[dateField]
        };

        res.json(response);
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
    let collection = dailyCollection;
    let dateField = 'horoscope_date';

    if (type === 'weekly') {
        queryDate = getWeekStart(date);
        collection = weeklyCollection;
        dateField = 'week_start_date';
    }

    try {
        const query = {};
        query[dateField] = queryDate;

        const results = await collection
            .find(query, { projection: { _id: 0 } })
            .sort({ sign_id: 1 })
            .toArray();

        // Format response to match MySQL structure
        const formattedResults = results.map(result => ({
            id: result.sign_id,
            sign_name: result.sign_name,
            symbol: result.symbol,
            daily_horoscope: result.daily_horoscope || '',
            weekly_horoscope: result.weekly_horoscope || '',
            horoscope_date: result[dateField]
        }));

        res.json(formattedResults);
    } catch (err) {
        console.error('Fetch all error:', err);
        res.status(500).json({ error: 'Database fetch failed' });
    }
});

// Start server
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
