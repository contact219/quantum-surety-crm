import express from 'express';
import cors from 'cors';
import { contactsRouter } from './routes/contacts.js';
import { emailRouter } from './routes/email.js';
import { importRouter } from './routes/import.js';
import { campaignsRouter } from './routes/campaigns.js';

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '50mb' }));
app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.use('/api/contacts', contactsRouter);
app.use('/api/email', emailRouter);
app.use('/api/import', importRouter);
app.use('/api/campaigns', campaignsRouter);
app.listen(process.env.PORT || 4000, () => console.log('CRM backend running'));
