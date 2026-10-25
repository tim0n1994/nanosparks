# Security policy

NanoSparks is maintained as a public application project. Do not open a
public issue for credentials, private data, or an exploitable vulnerability.

Report vulnerabilities through GitHub's private advisory channel:

https://github.com/tim0n1994/nanosparks/security/advisories/new

Include the affected commit, impact, reproduction steps, and a suggested fix
when available. Remove credentials from reports and rotate any secret that may
have been exposed.

The `main` branch is the supported development line. Release artifacts and
production configuration are verified separately from this repository;
credentials, databases, queues, and generated deployment files stay outside
Git.
