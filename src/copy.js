// Plain-language descriptions of the four checks. UI-side only — the engine
// carries the short technical question, this carries the sentence a reader who
// has never heard the phrase "data contract" can act on.

export const CHECK_COPY = {
  schema: {
    plain: 'Does the new file still have the same columns, holding the same kinds of value?',
    catches: ['a column renamed or missing', 'an unexpected new column', 'numbers arriving as text'],
  },
  semantics: {
    plain: 'Do the values still mean what they used to mean?',
    catches: ['a category nobody has seen before', 'a familiar category that vanished', 'dollars switched to cents'],
  },
  freshness: {
    plain: 'Is the new file as up to date as the old one led you to expect?',
    catches: ['a feed that quietly stopped updating', 'an old extract re-sent as if it were new'],
  },
  distribution: {
    plain: 'Are the numbers roughly the size they have always been?',
    catches: ['values far outside anything seen before', 'a sudden jump or drop in row count', 'a column that has started coming through blank'],
  },
}

export const HOW_IT_WORKS = [
  {
    title: 'Upload a file you trust',
    body: 'A CSV that looked right — last week’s export, or any known-good extract. This is the baseline.',
  },
  {
    title: 'Upload the file that just arrived',
    body: 'The new CSV you want to check. Nothing is sent anywhere; both files are read inside this page.',
  },
  {
    title: 'Read which check it failed',
    body: 'The new file is measured against the old one four times over. The report names the check that caught the problem — and the ones that missed it.',
  },
]
