const { validateRequest } = require('../validation');
module.exports = function installContact(app, transporter) {
app.post('/api/contact', validateRequest, async (req, res, next) => {
  const { name, email, company, subject, message } = req.body;
  try {
    await transporter.sendMail({ from: process.env.EMAIL_USER, to: process.env.CONTACT_EMAIL || process.env.EMAIL_USER,
      replyTo: email, subject: `[WearAware] ${subject}`,
      text: `Name: ${name}\nEmail: ${email}\nCompany: ${company || '—'}\n\n${message}` });
    res.json({ success: true, message: 'Message sent successfully.' });
  } catch (err) { next(err); }
});

};
