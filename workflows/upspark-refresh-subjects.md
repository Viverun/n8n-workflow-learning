# UpSpark: Refresh Subjects (one-off)

n8n workflow `ugIlo38UFiNrfPLG`. Manual run only.

Reads the UpSpark Prospects sheet, takes up to 60 unsent rows (send not Yes, sent_at empty)
from the automation-fit industries, asks Azure GPT (one call at a time, 1.5 s apart) for a
benefit-led subject ("Automate your workflow at ...", "Grow your business, ..."), checks it
contains the company name and no spam words (template fallback otherwise), and writes it back
to the row's `subject` column. Same prompt as the collector's "Write Personalized Subject" node.
