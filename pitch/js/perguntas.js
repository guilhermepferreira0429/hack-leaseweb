// Perguntas prováveis do júri, com a resposta de uma frase em inglês, quem responde e o anexo a abrir.
// A versão longa, em português, está em docs/perguntas-juri.md. Regra: uma frase, um facto, parar.
window.PERGUNTAS = [
  { p: 'Is the Leaseweb part real?', r: 'Yes: the API calls, the rule closing and the nmap are real. Only the AWS side is simulated, with LocalStack.', quem: 'Enio Carlos', anexo: 'a-api' },
  { p: 'What if an API call fails halfway?', r: 'We confirm the close from outside with nmap, not just the API; a failure is audited and reported, and the inverse is stored.', quem: 'Enio Carlos', anexo: 'a-api' },
  { p: 'Does it work beyond this demo app?', r: 'The translator covers S3, SQS, RDS, ElastiCache and Secrets Manager today, and flags Lambda and IAM as needing redesign instead of guessing.', quem: 'Guilherme', anexo: 'a-migra' },
  { p: 'What does the AI actually decide?', r: 'Nothing that runs: it explains, classifies and writes the report; actions come from a closed list in the code.', quem: 'Guilherme', anexo: 'a-ia' },
  { p: 'What if the AI closes the wrong thing?', r: 'It cannot choose the action; a human approves, the inverse is stored, and undo is one click.', quem: 'Enio Carlos', anexo: 'a-auditoria' },
  { p: 'Audit trail?', r: 'Every action is a line: who, when, before, after, and its inverse. It can be exported.', quem: 'Enio Carlos', anexo: 'a-auditoria' },
  { p: "Isn't an attacking agent risky?", r: 'It only touches our own IPs on an allowlist, with the organisers told; at most 20 attempts, it stops at the first entry and writes nothing.', quem: 'David', anexo: 'a-atacante' },
  { p: 'What if someone steals the Telegram bot?', r: 'It only obeys the owner ID, and even then only reversible actions from the list, all audited.', quem: 'David', anexo: 'a-atacante' },
  { p: 'What if nobody answers at night?', r: 'Night mode: for a critical finding it opens the port to known IPs only, reversibly, and warns the owner.', quem: 'Enio Carlos', anexo: 'a-noite' },
  { p: 'Why not GPT or Claude?', r: "Customers' security data should not leave the EU; we use European inference, and fixed text if the model fails.", quem: 'Guilherme', anexo: 'a-ia' },
  { p: "Why wouldn't Leaseweb just build this?", r: "You could, and it's open source so you can start from ours today. What we built is the flow: migrate, attack, fix, prove.", quem: 'Guilherme', anexo: 'a-encaixe' },
  { p: 'Who pays for this?', r: "We haven't validated pricing. The natural buyers are companies leaving a hyperscaler and the partners who migrate them.", quem: 'Guilherme', anexo: 'a-encaixe' },
  { p: 'You built this in one day. Why trust it?', r: "Don't trust us, check it: {testes} tests, an audit line for every action, and every action can be undone.", quem: 'Guilherme', anexo: 'a-auditoria' },
  { p: 'What would you do with one more month?', r: 'More services in the translator, the code-fix step hardened, and the report shaped for NIS2 and DORA notifications.', quem: 'Guilherme', anexo: null },
  { p: 'How do I run it?', r: 'One command, a .env.example and the README; the repo is public under Apache 2.0.', quem: 'Enio Carlos', anexo: null },
  { p: 'Is this a real problem on Leaseweb?', r: 'Even our fresh account started with a Default security group open to all ports. That is exactly the kind of gap we catch.', quem: 'Enio Carlos', anexo: 'a-api' },
  { p: 'Does it only work on Leaseweb?', r: 'Today, yes. The provider is one adapter file; Hostinger or OVHcloud would be another with the same operations. Not built yet.', quem: 'Guilherme', anexo: 'a-encaixe' },
  { p: 'Where does the data end up?', r: "On the owner's server in Frankfurt, in open services; the certificate lists each piece, its provider and country.", quem: 'Guilherme', anexo: 'a-certificado' },
  { p: 'Is the certificate an official certification?', r: 'No. It is an audit-ready record built only from our logs; the AI writes just the three-line summary.', quem: 'Guilherme', anexo: 'a-certificado' },
];
