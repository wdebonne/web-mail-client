/**
 * Import/Export de contacts compatibles avec les principaux logiciels :
 * - vCard 3.0 / 4.0 (Apple Contacts, Android, Thunderbird, iOS, macOS...)
 * - CSV Google Contacts
 * - CSV Outlook / Microsoft 365
 * - CSV générique
 */

export interface ImportedContact {
  firstName?: string;
  lastName?: string;
  displayName?: string;
  email?: string;
  phone?: string;
  mobile?: string;
  company?: string;
  jobTitle?: string;
  department?: string;
  notes?: string;
  avatarUrl?: string;
  website?: string;
  birthday?: string;
  address?: string;
  metadata?: Record<string, any>;
}

// ---------- vCard ----------

function unescapeVCard(v: string): string {
  return v.replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
}

function escapeVCard(v: string): string {
  return (v || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
}

function parseVCardBlock(block: string): ImportedContact | null {
  // unfold lines (RFC 6350): lines starting with space/tab continue previous
  const unfolded = block.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '');
  const lines = unfolded.split(/\r?\n/).filter(Boolean);

  const c: ImportedContact = {};
  let photoData: string | undefined;
  let photoMime = 'image/jpeg';

  for (const line of lines) {
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const left = line.substring(0, colon);
    const value = line.substring(colon + 1);
    const parts = left.split(';');
    const key = parts[0].toUpperCase();
    const params: Record<string, string> = {};
    for (let i = 1; i < parts.length; i++) {
      const eq = parts[i].indexOf('=');
      if (eq > 0) params[parts[i].substring(0, eq).toUpperCase()] = parts[i].substring(eq + 1);
      else params['TYPE'] = (params['TYPE'] ? params['TYPE'] + ',' : '') + parts[i];
    }
    const types = (params['TYPE'] || '').toUpperCase();

    switch (key) {
      case 'FN':
        c.displayName = unescapeVCard(value);
        break;
      case 'N': {
        const [ln, fn] = value.split(';').map(unescapeVCard);
        c.lastName = ln || c.lastName;
        c.firstName = fn || c.firstName;
        break;
      }
      case 'EMAIL':
        if (!c.email) c.email = value.trim().toLowerCase();
        break;
      case 'TEL':
        if (types.includes('CELL') || types.includes('MOBILE')) c.mobile = value.trim();
        else if (!c.phone) c.phone = value.trim();
        break;
      case 'ORG': {
        const [org, dept] = value.split(';').map(unescapeVCard);
        c.company = org;
        if (dept) c.department = dept;
        break;
      }
      case 'TITLE':
        c.jobTitle = unescapeVCard(value);
        break;
      case 'NOTE':
        c.notes = unescapeVCard(value);
        break;
      case 'URL':
        c.website = value.trim();
        break;
      case 'BDAY':
        c.birthday = value.trim();
        break;
      case 'ADR': {
        // ADR: post-office-box;extended;street;locality;region;postal-code;country
        const parts = value.split(';').map(unescapeVCard);
        const [, , street, city, region, zip, country] = parts;
        c.address = [street, [zip, city].filter(Boolean).join(' '), region, country]
          .filter(Boolean).join(', ');
        break;
      }
      case 'PHOTO': {
        if (params['ENCODING']?.toUpperCase() === 'B' || params['VALUE']?.toUpperCase() === 'URI' || value.startsWith('data:')) {
          if (value.startsWith('data:')) {
            photoData = value;
          } else {
            photoMime = 'image/' + (params['TYPE']?.toLowerCase() || 'jpeg').split(',')[0];
            photoData = `data:${photoMime};base64,${value.replace(/\s/g, '')}`;
          }
        } else if (value.startsWith('http')) {
          c.avatarUrl = value.trim();
        }
        break;
      }
    }
  }

  if (photoData && !c.avatarUrl) c.avatarUrl = photoData;

  if (!c.email && !c.displayName && !c.firstName && !c.lastName) return null;
  if (!c.displayName) c.displayName = [c.firstName, c.lastName].filter(Boolean).join(' ') || c.email;
  return c;
}

export function parseVCard(text: string): ImportedContact[] {
  const out: ImportedContact[] = [];
  const blocks = text.split(/BEGIN:VCARD/i).slice(1);
  for (const b of blocks) {
    const end = b.search(/END:VCARD/i);
    const block = end > 0 ? b.substring(0, end) : b;
    const c = parseVCardBlock(block);
    if (c) out.push(c);
  }
  return out;
}

export function generateVCard(contacts: Array<Partial<ImportedContact>>): string {
  const lines: string[] = [];
  for (const c of contacts) {
    lines.push('BEGIN:VCARD');
    lines.push('VERSION:3.0');
    const fn = c.displayName || [c.firstName, c.lastName].filter(Boolean).join(' ') || c.email || '';
    lines.push(`FN:${escapeVCard(fn)}`);
    lines.push(`N:${escapeVCard(c.lastName || '')};${escapeVCard(c.firstName || '')};;;`);
    if (c.email) lines.push(`EMAIL;TYPE=INTERNET:${c.email}`);
    if (c.phone) lines.push(`TEL;TYPE=WORK,VOICE:${c.phone}`);
    if (c.mobile) lines.push(`TEL;TYPE=CELL:${c.mobile}`);
    if (c.company || c.department) lines.push(`ORG:${escapeVCard(c.company || '')}${c.department ? ';' + escapeVCard(c.department) : ''}`);
    if (c.jobTitle) lines.push(`TITLE:${escapeVCard(c.jobTitle)}`);
    if (c.website) lines.push(`URL:${c.website}`);
    if (c.birthday) lines.push(`BDAY:${c.birthday}`);
    if (c.address) lines.push(`ADR;TYPE=WORK:;;${escapeVCard(c.address)};;;;`);
    if (c.notes) lines.push(`NOTE:${escapeVCard(c.notes)}`);
    if (c.avatarUrl && c.avatarUrl.startsWith('data:')) {
      const m = /^data:([^;]+);base64,(.*)$/.exec(c.avatarUrl);
      if (m) {
        const mime = m[1].split('/')[1]?.toUpperCase() || 'JPEG';
        lines.push(`PHOTO;ENCODING=b;TYPE=${mime}:${m[2]}`);
      }
    } else if (c.avatarUrl) {
      lines.push(`PHOTO;VALUE=URI:${c.avatarUrl}`);
    }
    lines.push('END:VCARD');
  }
  return lines.join('\r\n') + '\r\n';
}

// ---------- CSV ----------

function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = '';
  let inQuotes = false;
  // strip BOM
  if (text.charCodeAt(0) === 0xFEFF) text = text.substring(1);

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ',') { cur.push(field); field = ''; }
      else if (ch === '\r') { /* skip */ }
      else if (ch === '\n') { cur.push(field); field = ''; rows.push(cur); cur = []; }
      else field += ch;
    }
  }
  if (field.length > 0 || cur.length > 0) { cur.push(field); rows.push(cur); }
  return rows.filter(r => r.some(f => f && f.trim()));
}

function csvEscape(v: string): string {
  if (v == null) return '';
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function parseContactsCSV(text: string): ImportedContact[] {
  const rows = parseCSV(text);
  if (rows.length < 2) return [];
  const headers = rows[0].map(h => h.trim());
  const lc = headers.map(h => h.toLowerCase());

  // Map header -> column indexes (support Google, Outlook, and generic)
  const idx = (names: string[]): number => {
    for (const n of names) {
      const i = lc.indexOf(n.toLowerCase());
      if (i >= 0) return i;
    }
    return -1;
  };

  const col = {
    firstName: idx(['First Name', 'Given Name', 'Prénom', 'Prenom']),
    lastName: idx(['Last Name', 'Family Name', 'Nom']),
    displayName: idx(['Name', 'Display Name', 'Full Name', 'Nom complet']),
    email: idx(['E-mail Address', 'E-mail 1 - Value', 'Email', 'E-mail', 'Primary Email', 'Email Address']),
    email2: idx(['E-mail 2 - Value', 'E-mail 2 Address', 'Secondary Email']),
    phone: idx(['Business Phone', 'Phone 1 - Value', 'Home Phone', 'Primary Phone', 'Phone', 'Téléphone']),
    mobile: idx(['Mobile Phone', 'Phone 2 - Value', 'Cell Phone', 'Mobile']),
    company: idx(['Company', 'Organization 1 - Name', 'Entreprise', 'Company Name']),
    jobTitle: idx(['Job Title', 'Organization 1 - Title', 'Title', 'Fonction']),
    department: idx(['Department', 'Organization 1 - Department', 'Service']),
    notes: idx(['Notes', 'Note']),
    website: idx(['Web Page', 'Website 1 - Value', 'Website', 'URL', 'Site web']),
    birthday: idx(['Birthday', 'Date of Birth', 'Anniversaire']),
    address: idx([
      'Home Street', 'Business Street', 'Address 1 - Street',
      'Address 1 - Formatted', 'Adresse',
    ]),
    city: idx(['Home City', 'Business City', 'Address 1 - City', 'Ville']),
    zip: idx(['Home Postal Code', 'Business Postal Code', 'Address 1 - Postal Code', 'Code postal']),
    country: idx(['Home Country/Region', 'Business Country/Region', 'Address 1 - Country', 'Pays']),
  };

  const out: ImportedContact[] = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const get = (i: number) => (i >= 0 && i < row.length ? (row[i] || '').trim() : '');
    const email = get(col.email) || get(col.email2);
    const firstName = get(col.firstName);
    const lastName = get(col.lastName);
    const displayName = get(col.displayName) || [firstName, lastName].filter(Boolean).join(' ') || email;
    if (!email && !displayName) continue;

    const addrParts = [get(col.address), [get(col.zip), get(col.city)].filter(Boolean).join(' '), get(col.country)].filter(Boolean);

    out.push({
      firstName: firstName || undefined,
      lastName: lastName || undefined,
      displayName: displayName || undefined,
      email: email ? email.toLowerCase() : undefined,
      phone: get(col.phone) || undefined,
      mobile: get(col.mobile) || undefined,
      company: get(col.company) || undefined,
      jobTitle: get(col.jobTitle) || undefined,
      department: get(col.department) || undefined,
      notes: get(col.notes) || undefined,
      website: get(col.website) || undefined,
      birthday: get(col.birthday) || undefined,
      address: addrParts.length ? addrParts.join(', ') : undefined,
    });
  }
  return out;
}

export type CsvFormat = 'google' | 'outlook' | 'generic';

export function generateContactsCSV(contacts: Array<Partial<ImportedContact>>, format: CsvFormat = 'google'): string {
  let headers: string[];
  let row: (c: Partial<ImportedContact>) => string[];

  if (format === 'outlook') {
    headers = [
      'First Name', 'Last Name', 'Company', 'Department', 'Job Title',
      'Business Street', 'Business Phone', 'Mobile Phone',
      'E-mail Address', 'Web Page', 'Birthday', 'Notes',
    ];
    row = (c) => [
      c.firstName || '', c.lastName || '', c.company || '', c.department || '', c.jobTitle || '',
      c.address || '', c.phone || '', c.mobile || '',
      c.email || '', c.website || '', c.birthday || '', c.notes || '',
    ];
  } else if (format === 'google') {
    headers = [
      'Name', 'Given Name', 'Family Name',
      'E-mail 1 - Value', 'Phone 1 - Value', 'Phone 2 - Value',
      'Organization 1 - Name', 'Organization 1 - Title', 'Organization 1 - Department',
      'Address 1 - Formatted', 'Website 1 - Value', 'Birthday', 'Notes',
    ];
    row = (c) => [
      c.displayName || '', c.firstName || '', c.lastName || '',
      c.email || '', c.phone || '', c.mobile || '',
      c.company || '', c.jobTitle || '', c.department || '',
      c.address || '', c.website || '', c.birthday || '', c.notes || '',
    ];
  } else {
    headers = ['Display Name', 'First Name', 'Last Name', 'Email', 'Phone', 'Mobile', 'Company', 'Job Title', 'Department', 'Address', 'Website', 'Birthday', 'Notes'];
    row = (c) => [
      c.displayName || '', c.firstName || '', c.lastName || '',
      c.email || '', c.phone || '', c.mobile || '',
      c.company || '', c.jobTitle || '', c.department || '',
      c.address || '', c.website || '', c.birthday || '', c.notes || '',
    ];
  }

  const lines: string[] = [headers.join(',')];
  for (const c of contacts) lines.push(row(c).map(csvEscape).join(','));
  return '\uFEFF' + lines.join('\r\n') + '\r\n';
}

// ---------- Auto-detect ----------

export function parseContactsFile(filename: string, text: string): ImportedContact[] {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.vcf') || lower.endsWith('.vcard') || /BEGIN:VCARD/i.test(text.substring(0, 200))) {
    return parseVCard(text);
  }
  return parseContactsCSV(text);
}

export function downloadFile(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 500);
}
