// ─────────────────────────────────────────────────────────────
//  Add this to your server.js
//  1. npm install nodemailer
//  2. Add to your .env:
//       EMAIL_USER=your_gmail@gmail.com
//       EMAIL_PASS=your_gmail_app_password
//
//  NOTE: EMAIL_PASS must be a Gmail App Password, NOT your
//  regular Gmail password. Generate one at:
//  https://myaccount.google.com/apppasswords
//  (Requires 2-Step Verification to be enabled on the account)
// ─────────────────────────────────────────────────────────────

const nodemailer = require('nodemailer');

// Create transporter — put this near the top of server.js
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// ── Contact form route ──
app.post('/api/contact', async (req, res) => {
  const { name, email, company, subject, message } = req.body;

  if (!name || !email || !subject || !message) {
    return res.status(400).json({ error: 'Please fill in all required fields.' });
  }

  const subjectLabels = {
    inquiry: 'General Inquiry',
    demo: 'Request a Demo',
    support: 'Technical Support',
    other: 'Other',
  };

  const mailOptions = {
    from: `"WearAware Contact Form" <${process.env.EMAIL_USER}>`,
    to: 'wearawareph@gmail.com',
    replyTo: email,
    subject: `[WearAware] ${subjectLabels[subject] || subject} — from ${name}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1a202c;">
        <div style="background: linear-gradient(135deg, #667eea, #764ba2); padding: 24px 32px; border-radius: 12px 12px 0 0;">
          <h2 style="color: white; margin: 0; font-size: 1.3rem;">🦺 WearAware — New Contact Message</h2>
        </div>
        <div style="background: #f8fafc; padding: 32px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 12px 12px;">
          <table style="width: 100%; border-collapse: collapse; font-size: 0.95rem;">
            <tr>
              <td style="padding: 10px 0; font-weight: 700; color: #64748b; width: 140px;">Name</td>
              <td style="padding: 10px 0; color: #1a202c;">${name}</td>
            </tr>
            <tr>
              <td style="padding: 10px 0; font-weight: 700; color: #64748b;">Email</td>
              <td style="padding: 10px 0; color: #1a202c;"><a href="mailto:${email}" style="color: #667eea;">${email}</a></td>
            </tr>
            ${company ? `
            <tr>
              <td style="padding: 10px 0; font-weight: 700; color: #64748b;">Company</td>
              <td style="padding: 10px 0; color: #1a202c;">${company}</td>
            </tr>` : ''}
            <tr>
              <td style="padding: 10px 0; font-weight: 700; color: #64748b;">Subject</td>
              <td style="padding: 10px 0; color: #1a202c;">${subjectLabels[subject] || subject}</td>
            </tr>
          </table>

          <div style="margin-top: 24px; padding: 20px; background: white; border-radius: 8px; border: 1px solid #e2e8f0;">
            <div style="font-weight: 700; color: #64748b; font-size: 0.85rem; margin-bottom: 10px; text-transform: uppercase; letter-spacing: 0.05em;">Message</div>
            <p style="color: #334155; line-height: 1.75; margin: 0; white-space: pre-wrap;">${message}</p>
          </div>

          <p style="margin-top: 24px; font-size: 0.8rem; color: #94a3b8;">
            Reply directly to this email to respond to ${name}.
          </p>
        </div>
      </div>
    `,
  };

  try {
    await transporter.sendMail(mailOptions);
    res.json({ success: true, message: 'Message sent successfully.' });
  } catch (err) {
    console.error('Nodemailer error:', err);
    res.status(500).json({ error: 'Failed to send message. Please try again later.' });
  }
});