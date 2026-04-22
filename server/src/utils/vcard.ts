// Minimal RFC 6350 vCard 4.0 serializer. Compatible with SabreDAV (o2switch/RoundCube).

export interface VCardInput {
  uid: string;
  email?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  display_name?: string | null;
  phone?: string | null;
  mobile?: string | null;
  company?: string | null;
  job_title?: string | null;
  department?: string | null;
  notes?: string | null;
}

function escape(s: string | null | undefined): string {
  if (!s) return '';
  return String(s)
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\n|\r/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

function fold(line: string): string {
  if (line.length <= 75) return line;
  const out: string[] = [];
  let i = 0;
  while (i < line.length) {
    out.push((i === 0 ? '' : ' ') + line.slice(i, i + 73));
    i += 73;
  }
  return out.join('\r\n');
}

export function buildVCard(c: VCardInput): string {
  const fn = c.display_name || [c.first_name, c.last_name].filter(Boolean).join(' ') || c.email || 'Contact';
  const lines: string[] = [
    'BEGIN:VCARD',
    'VERSION:4.0',
    `UID:${escape(c.uid)}`,
    fold(`FN:${escape(fn)}`),
  ];
  if (c.first_name || c.last_name) {
    lines.push(fold(`N:${escape(c.last_name)};${escape(c.first_name)};;;`));
  }
  if (c.email) lines.push(fold(`EMAIL;TYPE=INTERNET:${escape(c.email)}`));
  if (c.phone) lines.push(fold(`TEL;TYPE=WORK,VOICE:${escape(c.phone)}`));
  if (c.mobile) lines.push(fold(`TEL;TYPE=CELL:${escape(c.mobile)}`));
  if (c.company || c.department) {
    lines.push(fold(`ORG:${escape(c.company)}${c.department ? ';' + escape(c.department) : ''}`));
  }
  if (c.job_title) lines.push(fold(`TITLE:${escape(c.job_title)}`));
  if (c.notes) lines.push(fold(`NOTE:${escape(c.notes)}`));
  lines.push(`REV:${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}`);
  lines.push('END:VCARD');
  return lines.join('\r\n') + '\r\n';
}
