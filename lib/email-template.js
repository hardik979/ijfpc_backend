// lib/email-templates.js
export function welcomeHtml({ name }) {
  return `
  <div style="font-family:Arial,Helvetica,sans-serif;line-height:1.6">
    <h2>Welcome to IT Jobs Factory, ${escapeHtml(name)}!</h2>
    <p>We're excited to have you on board. Your admission payment was received successfully.</p>
    <p>We've attached your receipt as a PDF. Keep it for your records.</p>
    <p>What’s next?</p>
    <ul>
      <li>Join the classes as per schedule (we’ll email/calendar invite)</li>
      <li>Track your progress on your dashboard</li>
      <li>Reach out to your counselor for any help</li>
    </ul>
    <p>— Team IT Jobs Factory</p>
  </div>`;
}

export function plainTextFallback({ name }) {
  return `Welcome to IT Jobs Factory, ${name}!\n\nYour payment was received. We've attached your receipt as a PDF.\n\n— Team IT Jobs Factory`;
}

function escapeHtml(s = "") {
  return s.replace(
    /[&<>"']/g,
    (m) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[
        m
      ])
  );
}
