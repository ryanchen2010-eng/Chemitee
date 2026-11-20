"""Private local feedback inbox. No public read endpoint or email delivery."""
import os
import sqlite3
import uuid
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path

PAGES = {'/', '/index.html', '/explore.html', '/builder.html', '/reaction-lab.html', '/calculators.html'}


def save_feedback(body, directory):
    if not isinstance(body, dict) or set(body) - {'category', 'message', 'context'}:
        raise ValueError('Invalid feedback fields.')
    category, message = body.get('category'), body.get('message')
    if category not in ('bug', 'chemistry', 'suggestion'):
        raise ValueError('Choose a feedback category.')
    if not isinstance(message, str) or not 10 <= len(message.strip()) <= 4000 or '\x00' in message:
        raise ValueError('Describe your feedback in 10–4000 characters.')
    context = body.get('context')
    if context is not None:
        if not isinstance(context, dict) or set(context) != {'page', 'device', 'details'}:
            raise ValueError('Invalid optional context.')
        if context['page'] not in PAGES or context['device'] not in ('desktop', 'mobile'):
            raise ValueError('Invalid page or device context.')
        if not isinstance(context['details'], str) or len(context['details']) > 1500 or '\x00' in context['details']:
            raise ValueError('Optional context must be at most 1500 characters.')
    directory = Path(directory)
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    path = directory / 'feedback.sqlite3'
    with closing(sqlite3.connect(path, timeout=5)) as db, db:
        os.chmod(path, 0o600)
        db.execute('CREATE TABLE IF NOT EXISTS feedback (id TEXT PRIMARY KEY, created TEXT, category TEXT, message TEXT, page TEXT, device TEXT, details TEXT)')
        db.execute('BEGIN IMMEDIATE')
        if db.execute("SELECT COUNT(*) FROM feedback WHERE created >= datetime('now', '-1 minute')").fetchone()[0] >= 10:
            raise OverflowError('Too many reports. Please wait a minute before trying again.')
        receipt = uuid.uuid4().hex
        created = datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S')
        db.execute('INSERT INTO feedback VALUES (?, ?, ?, ?, ?, ?, ?)', (receipt, created, category, message.strip(), (context or {}).get('page'), (context or {}).get('device'), (context or {}).get('details')))
    return {'receipt': receipt, 'message': 'Feedback saved to the project’s private inbox. Thank you.'}
