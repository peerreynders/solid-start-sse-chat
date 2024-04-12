```shell
git clone https://github.com/peerreynders/solid-start-sse-chat.git
    Cloning into 'solid-start-sse-chat'...
    remote: Enumerating objects: 293, done.
    remote: Counting objects: 100% (293/293), done.
    remote: Compressing objects: 100% (192/192), done.
    remote: Total 293 (delta 128), reused 235 (delta 74), pack-reused 0
    Receiving objects: 100% (293/293), 283.44 KiB | 2.27 MiB/s, done.
    Resolving deltas: 100% (128/128), done.
cd solid-start-sse-chat
git switch restart
    Branch 'restart' set up to track remote branch 'restart' from 'origin'.
    Switched to a new branch 'restart'
cp .env.example .env
pnpm install
    Lockfile is up to date, resolution step is skipped
    Packages: +573
    +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
    Progress: resolved 573, reused 573, downloaded 0, added 573, done

    dependencies:
    + @solidjs/meta 0.29.3
    + @solidjs/router 0.13.2
    + @solidjs/start 1.0.0-rc.0
    + nanoid 5.0.7
    + solid-js 1.8.16
    + vinxi 0.3.11

    devDependencies:
    + @typescript-eslint/eslint-plugin 7.6.0
    + @typescript-eslint/parser 7.6.0
    + eslint 8.57.0
    + eslint-config-prettier 9.1.0
    + prettier 3.2.5
    + typescript 5.4.5

    Done in 1.4s
pnpm run dev

    > solid-start-sse-chat@0.0.0 dev
    > vinxi dev

    vinxi v0.3.11
    vinxi starting dev server

      ➜ Local:    http://localhost:3000/
      ➜ Network:  use --host to expose
```

