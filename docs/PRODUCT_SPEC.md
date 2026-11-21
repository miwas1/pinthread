# PinThread — Construction drawing reviews with Nexconn Chat

A site lead opens a drawing and sees a supply duct crossing Beam B-14. The mechanical engineer has proposed a different route. Has the structural engineer agreed to that route, and which drawing were they looking at?

PinThread answers those questions at the spot where the clash was found. A pin opens a Nexconn conversation with the relevant drawing crop, the proposed fix, and the people whose review is still needed. When the last reviewer confirms the same proposal, the pin turns green on everyone’s drawing. A teammate arriving later can open it and see what the team agreed.

## The experience on site

The first users are contractors and design teams who already exchange marked-up drawings, phone photos, and questions across several firms. A site lead starts a **request for information (RFI)** by tapping a location on a sheet, describing the issue, and choosing the reviewers. An architect can review design intent, a structural engineer can review the effect on the structure, and a mechanical, electrical, and plumbing (MEP) lead can propose a change to the services layout.

Each reviewer receives a **Jump to pin** message that opens the same location and revision. The room supports ordinary conversation as well as five kinds of entries that people will need to find again.

| Entry | What the team sees and does |
| --- | --- |
| Issue brief | The drawing crop, sheet revision, grid reference, question, and required reviewers stay at the top of the room. |
| Field evidence | A photo or marked-up crop carries the author’s name and time. A reviewer can ask for a closer view in the same conversation. |
| Proposal | A reviewer describes the fix, marks its route on the crop, and records any known cost or schedule impact. A counterproposal creates a new version. |
| Hold | An authorized reviewer records what prevents approval and what evidence would clear it. The site lead can post corrective evidence for review. |
| Sign-off | Each required reviewer can approve the displayed proposal or request a change. The card names the people who have responded and the person the team is waiting for. |

The drawing supports pan, zoom, and aligned architectural, structural, and MEP layers. Each pin belongs to a specific sheet and revision and stores its position relative to that sheet. A reviewer who follows a link on a phone sees the same location as a colleague on a desktop. Pins show a text status alongside their color, and the issue list can be filtered by discipline, severity, or status.

## What changes a pin

A new issue is **Open**. Posting a proposal moves it to **In review**. It stays there until every required reviewer approves the same proposal version on the same drawing revision. The final approval changes the label to **Review complete** and turns the pin green. Opening a green pin shows each reviewer’s name, role, and approval time.

An active hold takes precedence and sets the pin to **Blocked**. Adding evidence gives the authorized reviewer something to assess. Clearing the hold returns the proposal to review. If someone edits the proposed route, the earlier approvals stay visible on the old version and the new version requires fresh approval.

The site lead can export the project’s RFI register as a PDF. Each record includes the marked drawing crop, revision, question, accepted proposal, and named sign-offs. A blocked or open issue prints with its current status and outstanding action. This gives the next shift a record it can use even if nobody who took part in the conversation is present.

## Where Nexconn fits

| Interaction | Nexconn Chat SDK integration | PinThread’s responsibility |
| --- | --- | --- |
| Raise an issue | A project uses a Nexconn Community. Each pin has a dedicated subchannel. A brief links the pin to its conversation. | Create the pin and crop, store the sheet reference, and assign the reviewers. |
| Bring in a discipline | A message in the relevant discipline subchannel carries the pin link. | Check project access and open the correct drawing, location, and room. |
| Discuss a fix | Reviewers send text, field images, and structured proposal messages. Connected participants receive them in the issue room. | Render proposal versions, redlines, and sign-off controls in context. |
| Record the decision | A structured decision message tells connected participants when a validated approval, hold, or revision changes an issue. | Verify the reviewer and proposal version on the server, persist the decision, and update the pin and review card together. |

The server issues a Nexconn token for each participant. Two demo roles use distinct identities and can connect from separate devices. Reopening a room loads the discussion history and the current decision record. A reconnect or repeated click must preserve one approval per reviewer and proposal version.

[Nexconn community messaging](https://docs.nexconn.ai/chatsdk-web/community-channel/chat) · [Nexconn message types](https://docs.nexconn.ai/chatsdk-web/message/send)

## The live demo

**Meridian Tower, Level 03, Rev B.** The demo opens on the spot where the supply duct crosses Beam B-14. The project already contains the site lead’s question and field photo. The judge can choose **Start as MEP lead** and open the structural engineer’s view in a second tab or on a phone. Each demo gets its own project session so the next visitor can try the same decision.

1. **Propose the reroute.** The MEP lead opens the beam clash, marks the proposed path on the crop, posts it, and confirms it for MEP. Both drawings show **In review · Waiting for Structural**.
2. **Follow the alert.** From the second device, the structural engineer selects **Jump to pin** and asks, “Does the dashed line show the new route?” The MEP lead sees the question and replies. The judge can substitute their own question to verify live delivery.
3. **Make the decision.** The structural engineer reviews the drawing and selects **Approve proposal**. The pin turns green on both devices. Opening it shows two named approvals against the marked route on Rev B.
4. **Hand it over.** Refresh either device and export the register. The drawing, thread, and PDF should agree on the proposal, revision, reviewers, and status.

A judge can also raise a fresh issue from a blank spot. Three other seeded pins make it easy to explore an electrical riser awaiting review, a slab inspection blocked pending evidence, and a completed curtain-wall review. The slab inspection demonstrates the exception path: the site lead attaches a corrective photo, the structural reviewer clears the hold, and the required reviewers finish the review.

## Adoption and evidence

The first buyer to test is the project manager who already chases answers across firms. A project subscription would let the manager invite outside reviewers to the specific issues that need their input. Test the original **$49 per project per month** price with this buyer. Keep guest reviews free so a subcontractor can answer a single question without a purchasing decision.

For a pilot, ask a site coordinator and a consultant to resolve one of their own drawing questions. Record whether the consultant followed the invite, whether both people completed the review without coaching, and whether someone opened a second issue voluntarily. Ask the next person on shift to find the accepted route and name its reviewers. Capture what they actually did, one point of confusion, and the change made in response.

| Challenge criterion | Evidence to submit |
| --- | --- |
| Required Nexconn Chat SDK usage | App Key in the write-up and submission form, plus a live exchange between two independently connected users. Identify the SDK-backed interactions in the write-up. |
| Completeness and UX · 50% | A judge can open the demo, send a message, finish the review, and retrieve a matching decision record. Show the flow across two screens in the video. |
| Innovation and scenario value · 30% | Use the beam clash to show why the location, conversation, and reviewers belong together. Show what the site lead sees while one review is outstanding and what changes when it arrives. |
| Business and growth potential · 20% | Report the observed number of pilot participants active on Nexconn, invitations accepted, and issues completed. Identify sample activity separately and include a practitioner’s feedback with permission. |

The submission package includes a runnable app URL, public GitHub repository, watchable demo video, and PDF project write-up with the Nexconn App Key. Real-user traction evidence can earn a bonus. [Official challenge rules](https://reskilll.com/hack/nexconn/rules)

## Further product development

Drawing uploads, multiple sheets, CSV export, and presence indicators would support teams using PinThread across a full project. A further revision-review feature would let a lead compare a changed area across drawings, flag affected decisions for another review, and retain the earlier approvals against the drawing on which they were given.
