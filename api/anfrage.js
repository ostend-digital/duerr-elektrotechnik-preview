// Anfrage-Endpunkt fuer duerr-elektrotechnik.de
//
// Ersetzt FormSubmit. Hintergrund (13.10.2026): FormSubmit verschickt die Anfragen
// als HTML-only-Mail von submissions@formsubmit.co, mit externem Tracking-Bild und
// einem Fremdwerbeblock im Footer. Das Postfach des Kunden laeuft auf Microsoft 365 /
// Exchange Online Protection und hat genau solche Mails in die Quarantaene gelegt.
//
// Diese Funktion verschickt stattdessen ueber Resend: eigener authentifizierter
// Absender (SPF/DKIM), Plain-Text UND HTML, kein Tracking, keine Fremdwerbung,
// Reply-To = der Anfragende. Keine npm-Abhaengigkeiten, nur fetch.
//
// Erwartete Environment-Variablen im Vercel-Projekt:
//   RESEND_API_KEY  (Pflicht)
//   MAIL_FROM       (Pflicht, z. B. "DÜRR Elektrotechnik <anfrage@mail.duerr-elektrotechnik.de>")
//   MAIL_TO         (optional, Default info@duerr-elektrotechnik.de)
//   MAIL_BCC        (optional, Blindkopie z. B. an Ostend)

const STANDARD_EMPFAENGER = 'info@duerr-elektrotechnik.de';

const ERLAUBTE_HERKUNFT = [
  'https://duerr-elektrotechnik.de',
  'https://www.duerr-elektrotechnik.de'
];

// Reihenfolge und Beschriftung der Felder in der Mail
const FELDER = [
  ['name', 'Name'],
  ['telefon', 'Telefon'],
  ['email', 'E-Mail'],
  ['anliegen', 'Anliegen'],
  ['seite', 'Abgeschickt auf'],
  ['datenschutz', 'Datenschutz-Einwilligung']
];

function escapeHtml(wert) {
  return String(wert)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Schuetzt davor, dass jemand ueber ein Feld zusaetzliche Header einschleust
function einzeilig(wert) {
  return String(wert == null ? '' : wert).replace(/[\r\n]+/g, ' ').trim();
}

function istMailadresse(wert) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(wert);
}

function herkunftErlaubt(origin) {
  if (!origin) return true; // direkte Server-Aufrufe (Monitoring, Tests)
  if (ERLAUBTE_HERKUNFT.indexOf(origin) !== -1) return true;
  return /^https:\/\/[a-z0-9-]+\.vercel\.app$/.test(origin); // Preview-Deployments
}

function textBauen(daten) {
  const zeilen = ['Neue Anfrage über das Kontaktformular auf duerr-elektrotechnik.de', ''];
  FELDER.forEach(function (feld) {
    const wert = daten[feld[0]];
    if (!wert) return;
    zeilen.push(feld[1] + ': ' + wert);
  });
  zeilen.push('', 'Eingegangen am ' + new Date().toLocaleString('de-DE', { timeZone: 'Europe/Berlin' }));
  zeilen.push('Antworten Sie einfach auf diese Mail — sie geht direkt an den Anfragenden.');
  return zeilen.join('\n');
}

function htmlBauen(daten) {
  const zeilen = FELDER.map(function (feld) {
    const wert = daten[feld[0]];
    if (!wert) return '';
    return '<tr>'
      + '<td style="padding:8px 14px 8px 0;vertical-align:top;color:#555;white-space:nowrap">' + escapeHtml(feld[1]) + '</td>'
      + '<td style="padding:8px 0;vertical-align:top;color:#111"><strong>' + escapeHtml(wert).replace(/\n/g, '<br>') + '</strong></td>'
      + '</tr>';
  }).join('');

  return '<!doctype html><html lang="de"><body style="margin:0;padding:24px;background:#f6f7f8;'
    + 'font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Arial,sans-serif;color:#111">'
    + '<div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e3e5e8;border-radius:10px;padding:28px">'
    + '<p style="margin:0 0 4px;font-size:13px;letter-spacing:.04em;text-transform:uppercase;color:#777">Kontaktformular</p>'
    + '<h1 style="margin:0 0 20px;font-size:20px;font-weight:600">Neue Anfrage über duerr-elektrotechnik.de</h1>'
    + '<table style="width:100%;border-collapse:collapse;font-size:15px;line-height:1.5">' + zeilen + '</table>'
    + '<p style="margin:24px 0 0;padding-top:16px;border-top:1px solid #e3e5e8;font-size:13px;color:#777">'
    + 'Eingegangen am ' + escapeHtml(new Date().toLocaleString('de-DE', { timeZone: 'Europe/Berlin' })) + '.<br>'
    + 'Antworten Sie einfach auf diese Mail — sie geht direkt an den Anfragenden.</p>'
    + '</div></body></html>';
}

module.exports = async function handler(req, res) {
  const origin = req.headers.origin;
  if (origin && herkunftErlaubt(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  }

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false, message: 'Nur POST.' });
  if (!herkunftErlaubt(origin)) return res.status(403).json({ success: false, message: 'Herkunft nicht erlaubt.' });

  let koerper = req.body;
  if (typeof koerper === 'string') {
    try { koerper = JSON.parse(koerper); } catch (e) { koerper = {}; }
  }
  if (!koerper || typeof koerper !== 'object') koerper = {};

  // Honeypot: Bots fuellen das unsichtbare Feld. Erfolg melden, nichts versenden.
  if (einzeilig(koerper._honey)) return res.status(200).json({ success: true });

  const daten = {
    name: einzeilig(koerper.name),
    telefon: einzeilig(koerper.telefon),
    email: einzeilig(koerper.email),
    anliegen: String(koerper.anliegen == null ? '' : koerper.anliegen).trim().slice(0, 5000),
    seite: einzeilig(koerper.seite),
    datenschutz: koerper.datenschutz ? 'erteilt' : ''
  };

  const fehlt = [];
  if (!daten.name) fehlt.push('Name');
  if (!daten.email) fehlt.push('E-Mail');
  else if (!istMailadresse(daten.email)) fehlt.push('gültige E-Mail');
  if (fehlt.length) {
    return res.status(400).json({ success: false, message: 'Bitte ergänzen: ' + fehlt.join(', ') + '.' });
  }

  const apiKey = process.env.RESEND_API_KEY;
  const absender = process.env.MAIL_FROM;
  if (!apiKey || !absender) {
    console.error('anfrage: RESEND_API_KEY oder MAIL_FROM fehlt im Vercel-Projekt.');
    return res.status(500).json({ success: false, message: 'Versand ist nicht konfiguriert.' });
  }

  const nachricht = {
    from: absender,
    to: (process.env.MAIL_TO || STANDARD_EMPFAENGER).split(',').map(function (s) { return s.trim(); }).filter(Boolean),
    reply_to: daten.email,
    subject: 'Neue Anfrage über duerr-elektrotechnik.de — ' + daten.name,
    text: textBauen(daten),
    html: htmlBauen(daten)
  };
  if (process.env.MAIL_BCC) {
    nachricht.bcc = process.env.MAIL_BCC.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  }

  const abbruch = new AbortController();
  const wecker = setTimeout(function () { abbruch.abort(); }, 8000);

  try {
    const antwort = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(nachricht),
      signal: abbruch.signal
    });
    const ergebnis = await antwort.json().catch(function () { return {}; });

    if (!antwort.ok) {
      console.error('anfrage: Resend hat abgelehnt', antwort.status, JSON.stringify(ergebnis));
      return res.status(502).json({ success: false, message: 'Der Versand hat nicht geklappt.' });
    }

    console.log('anfrage: versendet', ergebnis.id || '(ohne id)');
    return res.status(200).json({ success: true, id: ergebnis.id || null });
  } catch (fehler) {
    console.error('anfrage: Versand fehlgeschlagen', fehler && fehler.message);
    return res.status(502).json({ success: false, message: 'Der Versand hat nicht geklappt.' });
  } finally {
    clearTimeout(wecker);
  }
};
