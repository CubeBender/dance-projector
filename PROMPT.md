# Prompts

## 1. Original request (2026-10-17)

> I was tasked with creating and directing a visual projection at a dancing competition. It will be shown on a large screen and the contents will be dancing federation logo (image and video), schedule of matches, dancing rosters, scrutineer allocations (all fetched from a dans software https://www.dancesport.services/ that will be running on a server on the same network), live video feed and of course logos and videos of the competition sponsors. Scrutineers will also have assigned photos. I want to use OBS to create the presentation and to direct it. I have done something like this in the past and I used Touch Portal on my phone to manage the scenes even when not at my station which worked great. The resulting feed looked ok, but the visuals were amature (like the transitions and compositions) and when switching to scenes with videos, the videos would not pause at the background, thus we would return to them at seemingly random timestamps. My question is, can you help me create the presentation, the scenes and transitions? Are you good with OBS?
>
> I have OBS running with the configuration I used last year.
> There is also the Dans software running at localhost:8686. To access the dashboard, you can navigate to http://localhost:8686/control/. To see a simple manual, you can fetch pages at https://www.dancesport.services/index.html. It is running from C:\DanS folder. At the event, it will not be running locally and will be only accessible over network. Explore what you can find, what data can you get. I have downloaded 3 events, but left them in a vanilla state, where no dancers are presented. Be carefull, there is a function for finished competitions to send results to the federation and we cannot do that, that could have very bad consequences.

## 2. Follow-up (2026-10-17)

> Right now we are only using these events for scouting purposes. In Pardubice competition I have put three competitors through presentation, added scrutineers and created a first (final) round. Do you see the competition with a round and the seven selected scrutineers? For OBS, the live feed will be done using the elgato capture card that is in the LIVE scene. I want the current OBS scene setup saved somewhere so I can go back to it and then we can remove the Duel/VS scenes since we probably dont need them. And yes, the scrutineer allocation means judges selected for a specific competition, you got that right.

> If you look at the page http://localhost:8686/control/event/judges/competitions , you can see the judges allocated to specific competitions. That means it should be readable over API, right?

> I have also opened a round in the competition number three. It should have heats. Do you see them? What are they?

## 3. Electron app (2026-10-17)

> I think we could make our own electron app that would allow me to select cometition, add pictures and full display names to judges, track the current running competitions (there can be up to two competitions running at the same time when the dancing floor is split in half. There can technically be more running competitions, but only for limited time while one competition is ending and a new one is starting. For a competition to be running, the judging/evaluation needs to be enabled. The app would have a list of competitions with the running ones highlighted. The user would then select those that he wants to display. The app would have display outputs (web pages), that would show A) heats B) judges C) Maybe also when there are 2 competitions, a split screen that would show what competition is on which side with colour matching the dance floor side lighting (when floor is split, coloured lighting is used to distinguish them from each other). These pages would then be inside scenes of OBS.
>
> When working these kinds of projects, I like for you to create memory files. PROMPT.md for the original prompt. DECISIONS.md to write down your questions that require a decision from me and then write down my decision. When decisions change, the change is written down with a reason why change was made. SPEC.md for software or work specifications, PLAN.md for writing down plans, PROGRESS.md to keep track of progress. When the project is split into tasks, create a Docs folder and inside of it create a forder for each separate task that also contains its own PLAN.md, SPEC.md and all other things specific for that task that other tasks dont need. This is a general rule so remember it for future projects as well.

## 4. Revised requirements after technical consultation (2026-11-19)

> After consultation with other technical people, we have revised the required functionality. There is a concern about reading data using the API for the first time LIVE at an event of such importance. There is also no need ATM to show heats. Additionally, judges will be selected randomly for each competition just before the competition start. Therefore the usacases change a bit. First, there will be three modes of operation.
> 1) Manual mode - The judges will be selected manually by the operator of the software (me).
> 2) On demand mode - The data will not sync automatically, but on demand so the operator can time the data fetching right after the a judge panel was assigned, thus limiting the API calls.
> 3) Automatic mode - The current mode that fetches data automatically and frequently.
>
> The projection - Push or automatic. Since the judge selection can be in a state that is beying worked on, there is a need to not send the unfinished work to projection, but send the judge panel only after the data has been updated and verified. I imagine a button that "pushes" the current state to projection, which would stay the same until a new update is made.
>
> Customization of style - Each competition will have different color scheme. Could you make the colors and the background of the output (projection) customizable?
>
> One potential workflow could look like this: The judge panel gets selected and printed in Dans. The list gets printed out to distribute. I can get a copy. I can eather select the panel manually, or I could show the list in front of the web cam and the program could read it and make the selection for me. Is that possible to do and reliable? There would be a human review OFC before this gets pushed to projection.
>
> What would be the pros and cons of rewriting this app in RUST?

## 5. Judge gallery (2026-11-19)

> I will be building a gallery of judges that I want to keep so I dont have to do it from scratch every time. Inside the Docs/judges folder, there are photos of judges named IDT Surname Name Number (optional). I want to keep a gallery of judges and save them inside of the app. Each judge is uniquelly identified by their IDT with Name and Surname editable (this should be in the app already). Some judges sent multiple photos. I want to keep all of them and select the main photo / portrait from these so I can change, add, remove etc later.

> Also, comment your code more often, please, I am reviewing it and sometimes I have hard time following what is happening.
