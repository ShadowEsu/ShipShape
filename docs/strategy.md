# ShipShape — How We're Different

## The honest competitor check

| What we'd build | Who already does it | Verdict |
|---|---|---|
| AI that remembers your info and autofills PDFs | Filly, Instafill.ai, Simplicity AI, pdfFiller, AutoFillPDF | **Commodity.** Must have it, can't win on it |
| Legal templates + AI assistant | Rocket Lawyer (Copilot, ~$149–349/yr with attorney access), LegalZoom | **Crowded.** They have thousands of templates and lawyers on staff |
| "Which licenses/permits do I need?" | LegalZoom AI License Research (Mar 2026), BossWorks, SmallBizHandbook, state wizards | **Crowded** and legally risky |
| E-signatures | DocuSign, Dropbox Sign, PandaDoc | **Commodity.** Integrate, don't build |
| Permit/COI expiry tracking | PermitsAlert, myCOI, Billy, TrustLayer | Exists, but aimed at enterprises at $500+/mo |

Every one of these is **single-player**: one person fills one form alone.

## The gap: paperwork is multiplayer

Small businesses don't just *fill* documents. They **send the same documents over and over to other businesses:**

- A **contractor** sends their W-9, insurance certificate (COI), license and business registration to every new GC, client and property manager. Then again when the COI renews.
- A **freelancer** sends a W-9, signs the client's NDA and sends their own service agreement for every new client.
- A **restaurant** sends permits, COIs and tax forms to its landlord, suppliers, delivery apps and caterers, and collects the same documents back from its vendors.
- A **startup** sends SAFEs to investors, NDAs to partners and W-9s to customers' AP departments.

Today that's email attachments, "can you resend the updated COI?", and expired documents nobody noticed.

## ShipShape = your business's paperwork passport

**One link that holds everything other businesses ask you for, always up to date.**

`shipshape.app/acme-plumbing` → W-9 ✓ · COI (valid until Mar 2027) ✓ · License #12345 ✓ · NDA (sign here)

### The four pieces (same core for every type of business)
1. **Memory.** Your business profile, learned from every form you fill: name, EIN, address,
   entity, license numbers, insurance policy numbers, signature.
2. **Vault.** Every document you've filled, signed, uploaded or received, searchable by AI:
   "where's my NDA with Acme?" "what did I agree to pay the designer?"
3. **Passport link.** Share a live packet with anyone. You control what each person sees, and
   the link expires when you want. When your COI renews, everyone you shared with gets the new one.
   **Requests work both ways:** "Request W-9 + COI from my subcontractor" sends them a link.
   They fill it in with ShipShape (and become a user).
4. **Deadline brain.** AI reads every stored document for dates: license renewals, COI expiry,
   lease notice windows, auto-renewals, SAFE details. It reminds you *before* things lapse.

### Why this wins
- **Built-in growth (the Calendly effect):** every passport sent and every request made puts
  ShipShape in front of another business. Rocket Lawyer and Filly get none of that.
- **For everyone, one product:** contractors, freelancers, restaurants and startups all use
  the same four pieces. Only the starter document lists differ.
- **Gets better with time:** the more forms you fill, the more ShipShape remembers and the
  less you type. Switching away means leaving your whole paper trail.
- **Legally low-risk:** storing, filling, sharing and reminding is software, not legal advice.
  No AI-drafted clauses, no "you should use X."
- **B2C → B2B:** individuals use it free. Businesses that *collect* documents from many others
  (GCs, property managers, restaurant groups, accelerators, marketplaces) pay for a
  "collect" dashboard: request packets, see who's compliant, get alerts on expiries.

### Pricing sketch
- **Free:** profile, vault (limited), 1 passport link, basic autofill.
- **Pro (~$12–20/mo):** unlimited links and documents, deadline reminders, e-sign, AI search.
- **Collect (~$49–199/mo):** for businesses that request documents from many vendors/subs/clients.

## Starter lists per segment (official sources only, user chooses)
- **Freelancers/contractors:** W-9, service agreement (Common Paper PSA), NDA (Common Paper),
  COI upload, license upload, invoice terms.
- **Restaurants:** business license, food permits, COI, supplier/vendor agreements, W-9s from vendors,
  lease (upload), sales-tax permit.
- **Startups:** SAFE (YC link-out/import), NDA, consulting agreement, W-9, SS-4 (EIN), cloud/SaaS agreements (Common Paper).
- **Small businesses (general):** W-9, vendor agreements, NDA, permits, insurance.

## Build order (web)
1. Profile + vault + PDF autofill (upload any PDF, fill from profile, tap to sign, download with lawyer-review notice).
2. **Passport link** (share a live packet; viewer sees/downloads; tracking of who viewed).
3. **Request flow** (ask another business for documents; they fill via ShipShape).
4. Deadline brain (date extraction + email reminders).
5. AI assistant over your vault (search, "what does this section say", "what's expiring").

## Validate before building everything
Talk to 10 contractors, 10 freelancers and 5 restaurant owners. Ask:
"How many times last month did you send a W-9, COI or license to someone? How did you send it?
Has something ever expired without you noticing?" If the answer is "constantly," build the passport first.

## Sources
- Form fillers: [Filly](https://getfilly.app/), [Instafill.ai](https://instafill.ai/), [Simplicity AI](https://apps.apple.com/us/app/ai-pdf-form-filler/id6756451420), [pdfFiller AI](https://ai-pdf-form-filler.pdffiller.com/), [AutoFillPDF](https://autofillpdf.com/)
- Legal platforms: [Rocket Lawyer vs LegalZoom 2026](https://ailawyer.pro/blog/rocket-lawyer-vs-legalzoom), [Rocket Lawyer review 2026](https://boostsuite.com/reviews/rocket-lawyer/)
- Licenses: [LegalZoom AI license research](https://www.legalzoom.com/press-releases/legalzooms-ai-powered-business-license-platform), [BossWorks](https://bossworks.ai/business-licensing-explorer), [SmallBizHandbook](https://smallbizhandbook.com/tools/business-license-lookup), [PermitsAlert](https://www.permitsalert.com/)
- COI tracking: [Billy — best COI tracking 2026](https://billyforinsurance.com/resources/best-coi-tracking-software/), [imagetotable on small GCs](https://imagetotable.ai/blog/coi-tracking-software-vs-ai-spreadsheet-construction)
