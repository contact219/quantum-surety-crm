import json
d = {
  "subject": "Your Notary Bond Expires {{expire_date}}",
  "body": "<p>Hi {{first_name}},</p><p>Your notary bond expires on {{expire_date}}. Quantum Surety can renew it quickly and affordably.</p><p>Reply to this email or visit quantumsurety.bond to get started.</p><p>-- Quantum Surety Team</p><p style=\"font-size:11px;color:#999\"><a href=\"{{unsubscribe_url}}\">Unsubscribe</a></p>",
  "from_name": "Quantum Surety",
  "from_email": "info@quantumsurety.bond",
  "expiring_days": 90,
  "emails_per_day": 340
}
open("/tmp/drip.json", "w").write(json.dumps(d))
print("written")
