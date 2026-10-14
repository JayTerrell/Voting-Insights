# Candidate research spec (Texas, November 3, 2026 general election)

Today is 2026-10-14. You are researching candidates on certified Texas county ballots for a strictly
nonpartisan voter guide. The roster and race ids are in data/races.json, and data/ballots/<county>.json lists which races are on each county ballot.
The fixed issue questionnaire is in data/questions.json. Read both first.

Use WebSearch and WebFetch heavily. Good sources: candidate campaign websites, Texas Legislature Online
(capitol.texas.gov), Texas Tribune, Dallas Morning News, Community Impact, KERA, Houston Chronicle,
Ballotpedia, VOTE411 / League of Women Voters responses, Texas Ethics Commission, court websites
(txcourts.gov, collincountytx.gov), official agency pages, Vote Smart, candidate interviews and debates,
State Bar of Texas, Collin County Bar polls, newspaper endorsement questionnaires (DMN publishes candidate
questionnaires). Note: primaries were March 3, 2026 and runoffs May 26, 2026, so 2026 campaign coverage exists.

## Hard rules

1. Neutrality. Describe, do not evaluate. Use the candidate's own framing for priorities ("Says he will...",
   "Campaigns on..."). Never use loaded adjectives (extreme, radical, common-sense, far-right, far-left).
   Apply the same standard of scrutiny to every candidate regardless of party.
2. Only documented facts. Every stance, promise, record item and note must cite at least one source id.
   Only cite URLs you actually saw in search results or fetched. Never invent or guess a URL. If you could
   not verify something, leave it out.
3. Never infer a candidate's position from their party label. If no documented position exists, omit the
   stance entirely. Missing data is acceptable and expected for many down-ballot candidates.
4. NO em dashes or en dashes anywhere (no "—" and no "–"). Use commas, periods, colons, parentheses, or a
   plain hyphen. Do not use the phrasing pattern "It's not X, it's Y". No emojis.
5. Write in plain, formal English. Short sentences. Proper case names (e.g. "Ken Paxton" not "KEN PAXTON").
6. For judicial candidates: Texas judicial ethics rules bar candidates from promising outcomes on issues.
   Focus on qualifications, experience, judicial philosophy they have stated publicly, notable rulings
   (for incumbents), bar poll results, endorsements from legal organizations, and court administration
   goals. Only score q_textualism / q_judicial_selection when they have publicly addressed those topics.
7. For incumbents and former officeholders, include their record (votes, bills authored, rulings, budgets,
   official actions), and note where current positions differ from earlier ones.
8. Significant documented legal, ethics, or controversy matters covered by major outlets (indictments,
   impeachments, sanctions, lawsuits, official investigations) go in "notes" with neutral factual wording
   and outcome, applied by the same standard to every candidate.

## Stance scoring

For each question in questions.json whose "offices" list includes the race's office_type, decide whether the
candidate has a documented position. Position scale relative to the question statement:
2 = strongly agree, 1 = agree / leans agree, 0 = mixed or conditional, -1 = disagree / leans disagree,
-2 = strongly disagree.
"basis" must be one of:
"record" votes, bills authored, official actions, rulings
"statement" their own words: website, speech, interview, social media, debate
"questionnaire" answers to VOTE411, newspaper, or advocacy group questionnaires
"reported" credible news reporting describing their position
"inferred" derived from closely related documented positions or endorsements by issue groups
(explain the link in the summary). Never infer from party alone.
You MAY also score questions outside the office's list if the candidate clearly addressed them.

## Output

Write a single JSON file to the path given in your task. It must be valid JSON (verify with
`python3 -c "import json;json.load(open('PATH'))"`). Structure:

{
"candidates": [
{
"id": "<candidate id exactly as in races.json>",
"race_id": "<race id from races.json>",
"incumbent": true | false,
"current_role": "Short current occupation or office, e.g. 'Texas Attorney General since 2015'",
"background": "2 to 4 neutral sentences: profession, education, prior offices, residence.",
"website": "https://... campaign site or null",
"priorities": ["Campaign priorities in the candidate's framing, 3 to 6 items, each one sentence"],
"promises": ["Specific commitments: 'Says he will file legislation to ...'. Empty list if none found."],
"record": [ {"text": "One sentence about a vote, bill, ruling or action, with year.", "sources": ["s1"]} ],
"notes": [ {"text": "Neutral factual note (endorsements by major groups, bar poll result, legal matters).", "sources": ["s2"]} ],
"stances": {
"<question id>": {"position": -2..2, "basis": "statement", "summary": "One sentence describing their documented view.", "sources": ["s1"]}
},
"issue_notes": [
{"topic": "Short topic name, e.g. Water, Property Taxes, Grid, Veterans, Housing, Public Safety",
"summary": "One or two sentences on a documented position not captured by the questionnaire.",
"sources": ["s3"]}
],
"sources": [
{"id": "s1", "title": "Page or article title", "publisher": "Outlet or site", "url": "https://...", "date": "YYYY-MM-DD or YYYY-MM or null"}
],
"research_gaps": "One sentence on what could not be found, or empty string."
}
]
}

priorities and promises entries must also be backed by sources: write them as objects
{"text": "...", "sources": ["s1"]} rather than bare strings.

Source ids are local to each candidate (s1, s2, ...). Aim for depth on major races (8 to 20 sources and as
many stances as are documented) and do your best on down-ballot races (even 1 to 3 sources is useful; an
official bio page or a Ballotpedia page is fine). Every candidate in your assignment must appear in the
output, even if almost empty.

When finished, reply with a short summary: candidates covered, total stances, and notable gaps.
