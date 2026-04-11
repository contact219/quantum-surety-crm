import { Router } from 'express';
import { db } from '../db.js';
import { sql } from 'drizzle-orm';

export const aiRouter = Router();

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

async function claude(prompt, system = '') {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5',
      max_tokens: 4000,
      system: system || 'You are an expert surety bond sales assistant for Quantum Surety, a Texas-licensed surety agency. Be concise, professional, and focused on converting leads to bond purchases.',
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!r.ok) {
    const err = await r.text();
    throw new Error(`Anthropic API error ${r.status}: ${err}`);
  }
  const j = await r.json();
  const text = j.content?.[0]?.text || '';
  console.log('Claude response length:', text.length);
  return text;
}

function safeParseJSON(text) {
  // Try direct parse first
  try { return JSON.parse(text); } catch(e) {}
  // Try extracting JSON from markdown code blocks
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (match) { try { return JSON.parse(match[1].trim()); } catch(e) {} }
  // Try finding first { to last }
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end !== -1) {
    try { return JSON.parse(text.slice(start, end+1)); } catch(e) {}
  }
  throw new Error('Could not parse JSON from Claude response');
}

// #1 Lead Scoring
aiRouter.post('/score-lead', async (req, res) => {
  const { contact } = req.body;
  try {
    const prompt = `Score this surety bond lead from 1-100 and explain why in 2 sentences.

Contact data:
- Name: ${contact.first_name || contact.company_name || 'Unknown'}
- Type: ${contact.contact_type || 'contractor'}
- Certification: ${contact.certification_type || contact.surety_company || 'N/A'}
- City: ${contact.city || 'Unknown'}
- State: ${contact.state || 'TX'}
- Expiry date: ${contact.expire_date || 'N/A'}
- Current carrier: ${contact.surety_company || 'N/A'}
- Has email: ${contact.email || contact.contact_email ? 'Yes' : 'No'}
- Has phone: ${contact.phone ? 'Yes' : 'No'}

Scoring criteria:
- Expiring within 90 days = very high urgency (+30 pts)
- Expiring within 180 days = high urgency (+20 pts)
- Already expired = re-engagement opportunity (+15 pts)
- Competitor carrier (not RLI) = switchable (+15 pts)
- Has email = contactable (+10 pts)
- HUB/DBE certified contractor = needs bond for state contracts (+10 pts)
- Major metro (Houston, Dallas, San Antonio, Austin) = higher competition awareness (+5 pts)

Respond in JSON only: {"score": 85, "reason": "...", "action": "Call immediately / Send renewal email / Add to drip / Low priority"}`;

    const response = await claude(prompt);
    const result = safeParseJSON(response);
    res.json(result);
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

// #1 Bulk lead scoring for top contacts
aiRouter.post('/score-bulk', async (req, res) => {
  const { contact_type = 'notary', limit = 50 } = req.body;
  try {
    let contacts = [];
    if (contact_type === 'notary') {
      const result = await db.execute(sql`
        SELECT id, first_name, last_name, email, city, expire_date, surety_company
        FROM notaries
        WHERE email != '' AND expire_date >= CURRENT_DATE
        AND expire_date <= CURRENT_DATE + INTERVAL '180 days'
        ORDER BY expire_date ASC LIMIT ${limit}
      `);
      contacts = result.rows;
    } else {
      const result = await db.execute(sql`
        SELECT id, company_name, city, state, certification_type, phone, website, email
        FROM contractors
        WHERE (website ~ '^[^@]+@[^@]+\\.[^@]+$' OR (email IS NOT NULL AND email != ''))
        ORDER BY RANDOM() LIMIT ${limit}
      `);
      contacts = result.rows;
    }

    const scored = [];
    for (const c of contacts.slice(0, 20)) { // limit API calls
      const prompt = `Score this surety bond lead 1-100. Respond JSON only: {"score":85,"action":"Send renewal email"}
Data: ${JSON.stringify(c)}
Criteria: expiring soon=+30, competitor carrier=+15, has email=+10, major TX city=+5`;
      try {
        const r = await claude(prompt);
        const clean = r.replace(/```json|```/g, '').trim();
        const parsed = JSON.parse(clean);
        scored.push({ ...c, ...parsed });
      } catch(e) { scored.push({ ...c, score: 50, action: 'Add to drip' }); }
      await new Promise(r => setTimeout(r, 200));
    }

    scored.sort((a, b) => (b.score || 0) - (a.score || 0));
    res.json(scored);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// #2 AI Email Personalization
aiRouter.post('/personalize-email', async (req, res) => {
  const { contact, template, campaign_type } = req.body;
  try {
    const prompt = `Personalize this email template for this specific contact. Make it feel genuinely personal, not templated. Keep HTML structure intact but make the copy specific to their situation.

Contact:
- Name: ${contact.first_name || contact.company_name}
- City: ${contact.city}
- Expiry: ${contact.expire_date || 'N/A'}
- Current carrier: ${contact.surety_company || contact.certification_type || 'N/A'}
- Type: ${campaign_type}

Template:
${template}

Return ONLY the personalized HTML, no explanation.`;

    const response = await claude(prompt);
    res.json({ html: response });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// #3 AI Campaign Copy Generator
aiRouter.post('/generate-campaign', async (req, res) => {
  const { brief, contact_type, tone } = req.body;
  try {
    const prompt = `Generate a complete email campaign for Quantum Surety based on this brief:

Brief: ${brief}
Contact type: ${contact_type} (${contact_type === 'notary' ? 'Texas notary public needing surety bond' : 'HUB/DBE certified minority contractor needing performance/payment bonds'})
Tone: ${tone || 'professional but friendly'}

Quantum Surety details:
- Texas-licensed surety agency
- Carrier: RLI Insurance Company (A+ rated)
- Notary bonds: starting $30/year, instant issuance
- Contractor bonds: same-day, no collateral for most
- Quote URL: https://quantumsurety.bond/quote
- Commission: 55% on notary bonds (for referrals)

Generate:
1. Subject line (compelling, under 60 chars)
2. Preview text (under 90 chars)  
3. Full HTML email body (professional, mobile-friendly, with {{first_name}} and {{expire_date}} variables)
4. 3 alternative subject lines
5. Recommended send time

Respond in JSON: {"subject":"...","preview":"...","html":"...","alt_subjects":["...","...","..."],"send_time":"..."}`;

    const response = await claude(prompt);
    const result = safeParseJSON(response);
    res.json(result);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// #4 AI Reply Classifier
aiRouter.post('/classify-reply', async (req, res) => {
  const { reply_text, contact_email } = req.body;
  try {
    const prompt = `Classify this email reply to a Quantum Surety surety bond marketing email.

Reply: "${reply_text}"

Classify as ONE of:
- INTERESTED: wants to buy or learn more
- NOT_INTERESTED: explicitly not interested
- ALREADY_RENEWED: already has a bond elsewhere
- WRONG_PERSON: not the right contact
- UNSUBSCRIBE: wants to stop receiving emails
- QUESTION: has a specific question
- CALLBACK_REQUEST: wants a phone call

Also provide:
- Priority: HIGH / MEDIUM / LOW
- Suggested response (1-2 sentences)
- Sentiment: positive / neutral / negative

JSON only: {"classification":"INTERESTED","priority":"HIGH","sentiment":"positive","suggested_response":"..."}`;

    const response = await claude(prompt);
    const result = safeParseJSON(response);

    // Log to DB
    await db.execute(sql`
      INSERT INTO email_events (contact_email, event_type, metadata)
      VALUES (${contact_email||''}, 'reply.classified', ${JSON.stringify(result)}::jsonb)
    `);

    res.json(result);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// #5 AI Objection Handler
aiRouter.post('/handle-objection', async (req, res) => {
  const { objection, contact_name, contact_type } = req.body;
  try {
    const prompt = `A potential Quantum Surety customer said: "${objection}"

Contact: ${contact_name || 'Unknown'} (${contact_type || 'notary'})

Write a professional, empathetic email response that:
1. Acknowledges their concern
2. Addresses the specific objection with facts
3. Provides a clear next step

Key facts about Quantum Surety:
- RLI Insurance: A+ AM Best rated, one of the most respected surety carriers
- Notary bonds from $30/year (often cheaper than competitors)
- Same-day issuance — no waiting
- 4-year term available (bond once for entire commission)
- Texas-licensed agency with local expertise
- Quote takes 10 minutes: quantumsurety.bond/quote

Common objections and responses:
- "Happy with current carrier" → RLI is likely cheaper and faster
- "Too expensive" → Starting at $30/year, cheaper than most
- "Already renewed" → Note their next renewal date
- "Don't need it" → Required by Texas law for notary commission

Write ONLY the email response, ready to send. Keep it under 150 words. Sign as "Ted Sparks, Quantum Surety"`;

    const response = await claude(prompt);
    res.json({ response });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// #6 AI Market Intelligence
aiRouter.post('/market-intelligence', async (req, res) => {
  try {
    const [notaryStats, contractorStats, recentEvents] = await Promise.all([
      db.execute(sql`
        SELECT surety_company, COUNT(*) as count,
          COUNT(*) FILTER (WHERE expire_date <= CURRENT_DATE + INTERVAL '90 days' AND expire_date >= CURRENT_DATE) as expiring_soon
        FROM notaries GROUP BY surety_company ORDER BY count DESC LIMIT 10
      `),
      db.execute(sql`
        SELECT state, certification_type, COUNT(*) as count FROM contractors
        GROUP BY state, certification_type ORDER BY count DESC LIMIT 10
      `),
      db.execute(sql`
        SELECT event_type, COUNT(*) as count FROM email_events
        WHERE created_at > now() - INTERVAL '30 days' GROUP BY event_type
      `),
    ]);

    const prompt = `You are a surety bond market analyst. Analyze this data for Quantum Surety and provide strategic recommendations.

Texas Notary Market by Carrier:
${notaryStats.rows.map(r => `- ${r.surety_company}: ${parseInt(r.count).toLocaleString()} total, ${parseInt(r.expiring_soon).toLocaleString()} expiring in 90 days`).join('\n')}

Contractor Database:
${contractorStats.rows.map(r => `- ${r.state} ${r.certification_type}: ${r.count}`).join('\n')}

Recent Email Activity (30 days):
${recentEvents.rows.map(r => `- ${r.event_type}: ${r.count}`).join('\n')}

Provide:
1. Top 3 immediate opportunities (with specific numbers)
2. Which competitor's customers to target first and why
3. Best performing market segment prediction
4. Recommended campaign sequence for next 30 days
5. Revenue potential estimate (avg notary bond = $35, contractor bond = $500-5000)

Be specific with numbers. Format as JSON:
{"opportunities":[{"title":"...","description":"...","potential_revenue":"...","action":"..."}],"top_competitor_target":"...","reasoning":"...","campaign_sequence":["..."],"monthly_revenue_potential":"..."}`;

    const response = await claude(prompt);
    const result = safeParseJSON(response);
    res.json(result);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// #7 AI Subject Line Optimizer
aiRouter.post('/optimize-subject', async (req, res) => {
  const { subject, contact_type, campaign_goal } = req.body;
  try {
    const prompt = `Optimize this email subject line for a Quantum Surety surety bond campaign.

Current subject: "${subject}"
Contact type: ${contact_type}
Goal: ${campaign_goal || 'maximize open rate'}

Generate 10 subject line variations using these proven techniques:
- Urgency/scarcity
- Personalization hooks
- Question format
- Number/stat inclusion
- Fear of missing out
- Benefit-focused
- Curiosity gap
- Direct/transactional

For each, predict open rate (industry avg is 21%) and explain the psychological trigger.

JSON only: {"variations":[{"subject":"...","predicted_open_rate":"28%","trigger":"urgency","explanation":"..."}]}`;

    const response = await claude(prompt);
    const result = safeParseJSON(response);
    res.json(result);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// #8 AI Contact Enrichment
aiRouter.post('/enrich-contact', async (req, res) => {
  const { company_name, city, state, certification_type, naics_codes, website } = req.body;
  try {
    const prompt = `Enrich this contractor profile for surety bond sales targeting.

Company: ${company_name}
Location: ${city}, ${state}
Certification: ${certification_type}
NAICS: ${naics_codes}
Website: ${website || 'unknown'}

Based on NAICS codes and certification type, provide:
1. Likely business type and services
2. Typical contract sizes they bid on
3. Bond types they likely need (performance, payment, license/permit)
4. Estimated bond amount needed
5. Best outreach approach
6. Likely pain points with bonding

JSON only: {"business_type":"...","services":"...","contract_sizes":"...","bond_types":["..."],"estimated_bond_amount":"...","outreach_approach":"...","pain_points":"...","priority_score":75}`;

    const response = await claude(prompt);
    const result = safeParseJSON(response);
    res.json(result);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// #9 AI Unsubscribe Analysis
aiRouter.post('/analyze-unsubscribes', async (req, res) => {
  try {
    const result = await db.execute(sql`
      SELECT u.email, u.source, u.created_at,
        e.metadata->>'campaign' as campaign
      FROM unsubscribes u
      LEFT JOIN email_events e ON e.contact_email = u.email
      ORDER BY u.created_at DESC LIMIT 100
    `);

    if (!result.rows.length) {
      return res.json({ analysis: 'No unsubscribes yet — great!', recommendations: [] });
    }

    const prompt = `Analyze these email unsubscribes for Quantum Surety and identify patterns.

Unsubscribe data:
${JSON.stringify(result.rows.slice(0, 20))}

Identify:
1. Common patterns (timing, campaign type, source)
2. Likely reasons people unsubscribed
3. What to change in campaigns
4. Which segments have highest unsubscribe rates
5. Recommended list hygiene actions

JSON: {"patterns":["..."],"likely_reasons":["..."],"recommendations":["..."],"high_risk_segments":["..."],"list_hygiene_actions":["..."]}`;

    const response = await claude(prompt);
    const result2 = safeParseJSON(response);
    res.json({ total_unsubscribes: result.rows.length, ...result2 });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// #10 AI Daily Briefing
aiRouter.post('/daily-briefing', async (req, res) => {
  try {
    const [expiring30, expiring90, recentSends, topLeads, contractorCount] = await Promise.all([
      db.execute(sql`SELECT COUNT(*) as count FROM notaries WHERE expire_date = CURRENT_DATE + INTERVAL '30 days' AND email != ''`),
      db.execute(sql`SELECT COUNT(*) as count FROM notaries WHERE expire_date <= CURRENT_DATE + INTERVAL '90 days' AND expire_date >= CURRENT_DATE AND email != ''`),
      db.execute(sql`SELECT COUNT(*) as count FROM email_events WHERE event_type = 'email.sent' AND created_at > now() - INTERVAL '24 hours'`),
      db.execute(sql`SELECT first_name, last_name, city, expire_date, surety_company FROM notaries WHERE expire_date <= CURRENT_DATE + INTERVAL '30 days' AND expire_date >= CURRENT_DATE AND email != '' ORDER BY expire_date ASC LIMIT 5`),
      db.execute(sql`SELECT COUNT(*) as count FROM contractors WHERE (website ~ '^[^@]+@[^@]+\\.[^@]+$')`),
    ]);

    const today = new Date().toLocaleDateString('en-US', {weekday:'long',month:'long',day:'numeric'});

    const prompt = `Generate a concise daily sales briefing for Ted Sparks at Quantum Surety.

Date: ${today}
Notaries expiring in exactly 30 days (hottest leads): ${expiring30.rows[0].count}
Notaries expiring within 90 days: ${expiring90.rows[0].count}
Emails sent in last 24 hours: ${recentSends.rows[0].count}
HUB/DBE contractors with email: ${contractorCount.rows[0].count}
Top expiring notaries today:
${topLeads.rows.map(n => `- ${n.first_name} ${n.last_name}, ${n.city}, expires ${new Date(n.expire_date).toLocaleDateString()}, carrier: ${n.surety_company}`).join('\n')}

Write a brief, motivating daily briefing that:
1. Highlights the top 3 actions for today
2. Mentions the revenue opportunity
3. Gives a specific recommendation
4. Is upbeat and action-oriented
Keep it under 200 words. Format as plain text, not JSON.`;

    const response = await claude(prompt);

    // Send as email
    const { Resend } = await import('resend');
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: 'Quantum Surety CRM <info@quantumsurety.bond>',
      to: ['administrator@quantumsurety.bond'],
      subject: `📊 Daily Briefing — ${today}`,
      html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px">
        <div style="border-bottom:3px solid #C9A84C;margin-bottom:20px;padding-bottom:12px">
          <h2 style="margin:0;color:#0A0A0F">Quantum Surety — Daily Briefing</h2>
          <p style="margin:4px 0 0;color:#666">${today}</p>
        </div>
        <div style="background:#f9f6ef;border-left:4px solid #C9A84C;padding:16px 20px;border-radius:0 6px 6px 0;margin-bottom:20px">
          <pre style="margin:0;font-family:Arial,sans-serif;white-space:pre-wrap;color:#333;line-height:1.7">${response}</pre>
        </div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:20px">
          <div style="background:#fff;border:1px solid #eee;border-radius:8px;padding:12px;text-align:center">
            <div style="font-size:24px;font-weight:bold;color:#C9A84C">${expiring30.rows[0].count}</div>
            <div style="font-size:11px;color:#666">Expiring in 30 days</div>
          </div>
          <div style="background:#fff;border:1px solid #eee;border-radius:8px;padding:12px;text-align:center">
            <div style="font-size:24px;font-weight:bold;color:#ef4444">${expiring90.rows[0].count}</div>
            <div style="font-size:11px;color:#666">Expiring in 90 days</div>
          </div>
          <div style="background:#fff;border:1px solid #eee;border-radius:8px;padding:12px;text-align:center">
            <div style="font-size:24px;font-weight:bold;color:#4C9AC9">${recentSends.rows[0].count}</div>
            <div style="font-size:11px;color:#666">Emails sent today</div>
          </div>
        </div>
        <a href="http://192.168.4.122:8095" style="background:#C9A84C;color:#000;padding:12px 24px;text-decoration:none;border-radius:6px;font-weight:bold;display:inline-block">Open CRM →</a>
      </div>`,
    });

    res.json({ ok: true, briefing: response });
  } catch(err) { res.status(500).json({ error: err.message }); }
});
