// Reads every practice question from the Notion database and returns them as JSON.
// Needs two Vercel environment variables: NOTION_TOKEN and NOTION_DATABASE_ID.

const NOTION_VERSION = '2022-06-28';

function cleanId(raw) {
  // Accepts a bare ID, a dashed ID, or a full Notion URL, and returns the 32-character ID.
  const match = String(raw || '').replace(/-/g, '').match(/[0-9a-f]{32}/i);
  return match ? match[0] : '';
}

function readProp(p) {
  if (!p) return '';
  switch (p.type) {
    case 'title': return p.title.map(t => t.plain_text).join('');
    case 'rich_text': return p.rich_text.map(t => t.plain_text).join('');
    case 'select': return p.select ? p.select.name : '';
    case 'multi_select': return p.multi_select.map(o => o.name).join(', ');
    case 'number': return p.number == null ? '' : String(p.number);
    case 'formula': return p.formula[p.formula.type] == null ? '' : String(p.formula[p.formula.type]);
    default: return '';
  }
}

function getProp(props, name) {
  const key = Object.keys(props).find(k => k.trim().toLowerCase() === name);
  return key ? readProp(props[key]).trim() : '';
}

export default async function handler(req, res) {
  const token = process.env.NOTION_TOKEN;
  const dbId = cleanId(process.env.NOTION_DATABASE_ID);

  if (!token || !dbId) {
    return res.status(500).json({
      error: 'The app is missing its Notion settings. Add NOTION_TOKEN and NOTION_DATABASE_ID in Vercel, then redeploy.'
    });
  }

  const questions = [];
  let cursor;

  try {
    do {
      const r = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Notion-Version': NOTION_VERSION,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(cursor ? { start_cursor: cursor, page_size: 100 } : { page_size: 100 })
      });
      const data = await r.json();

      if (!r.ok) {
        const hint = r.status === 404
          ? ' Check that NOTION_DATABASE_ID is the database ID and that the database is shared with your integration.'
          : r.status === 401 ? ' Check that NOTION_TOKEN is correct.' : '';
        return res.status(r.status).json({ error: `Notion said: ${data.message || 'unknown error'}.${hint}` });
      }

      for (const page of data.results) {
        const props = page.properties || {};
        const q = {
          id: page.id,
          question: getProp(props, 'question'),
          answer: getProp(props, 'answer'),
          kid: getProp(props, 'kid'),
          subject: getProp(props, 'subject') || 'General',
          topic: getProp(props, 'topic') || 'General',
          night: getProp(props, 'night')
        };
        if (q.question && q.kid) questions.push(q);
      }
      cursor = data.has_more ? data.next_cursor : undefined;
    } while (cursor);
  } catch (e) {
    return res.status(500).json({ error: `Could not reach Notion: ${e.message}` });
  }

  // Cache for a minute so pages load fast; new Notion questions show up within about a minute.
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
  return res.status(200).json({ questions });
}
