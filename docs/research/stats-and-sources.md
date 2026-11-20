# Why this matters — numbers and sources

Use at most three numbers in the pitch. Everything here is sourced; dates matter.

## Leaving a hyperscaler is slow

- Leaseweb Digital Independence Survey 2026 (Censuswide, 800 executives in NL, DE, UK, US; companies with
  500–5,000 employees; fieldwork 22–30 Sep 2026): only 11% could move away from their largest cloud provider
  within three weeks; 55% would need more than three months or could not move critical workloads at all;
  the Netherlands averages 4.7 months. 73% would pay at least 11% more for infrastructure independence.
  Sources: [ITPro](https://www.itpro.com/cloud/cloud-computing/nine-in-ten-businesses-cant-ditch-their-cloud-provider-heres-why),
  [Channel Insider](https://www.channelinsider.com/infrastructure/leaseweb-cloud-migration-msp-strategy/),
  [Dutch IT Channel](https://www.dutchitchannel.nl/news/764308/bijna-negen-op-de-tien-bedrijven-kunnen-kritische-workloads-niet-binnen-drie-weken-migreren).
- Main blocker: applications built around one provider's infrastructure ([TechRadar](https://www.techradar.com/pro/most-companies-dont-think-they-could-leave-their-main-cloud-provider-quickly-should-the-worst-happen)).
- Foundry Cloud Computing Study 2026 (527 IT decision makers): data portability (49%) and environment
  incompatibilities (42%) are migration obstacles ([Network World](https://www.networkworld.com/article/4247951/youve-decided-to-repatriate-cloud-workloads-now-what.html)).
- Business continuity during migration is the top concern for 75%; 38% cite lack of in-house expertise
  ([OpenText](https://blogs.opentext.com/key-considerations-for-it-leaders-repatriating-workloads/)).

## The migration window is when you are most exposed

- Misconfiguration is the leading cause of critical cloud incidents (45%), nearly double credential theft (22%)
  — SANS 2026 Cloud Security Survey ([Infosecurity](https://www.infosecurity-magazine.com/news/cloud-security-maturity-lags-sans/)).
- Smaller organisations report more permissive firewalls and exposed services than larger ones
  — Intruder 2026 Cloud Security Index, 3,000 orgs ([Help Net Security](https://www.helpnetsecurity.com/?p=381619)).
- Exposed services are found in minutes: in Unit 42's 320-honeypot study, 80% were compromised within 24 h,
  one actor hit 96% of 80 Postgres honeypots within 30 seconds, mean time to first SSH compromise ≈ 3 h
  ([Unit 42](https://unit42.paloaltonetworks.com/exposed-services-public-clouds/); **study from 2021** — say so).
- Old credentials travel with migrations: in AWS, 59% of IAM users have an active access key older than one year
  ([Datadog State of Cloud Security](https://www.datadoghq.com/state-of-cloud-security/)).

## Automation pays

- IBM Cost of a Data Breach 2026: global average $4.99M (record, +12%); organisations using AI and automation in
  security cut breach costs by almost $2M on average, and one in four still have not adopted them
  ([IBM newsroom](https://newsroom.ibm.com/2026-07-29-ibm-study-one-in-four-malicious-breaches-are-ai-enabled,-costing-companies-6-million-on-average)).

## Our own number

- Attempts on our bait VM since it went online at 08:00 today (measured live, shown on stage).

## Caveats

- The Leaseweb survey covers companies with 500–5,000 employees, not SMEs. Say "companies".
- Unit 42 data is from 2021. Our own measured number is the primary proof.
