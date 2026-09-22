# Deploy local (WSL) da Fase 2 do trik

## Contexto

O "servidor" de teste é o Ubuntu do WSL2 deste mesmo PC (`wsl -d Ubuntu`).
Lá dentro, `/opt/nodyx` é um clone do repo **original** (`Pokled/nodyx`,
upstream) — **sem nenhuma relação de git com este fork** (`trik-nodyx`).
`git pull` dentro de `/opt/nodyx` não traz nada do módulo RPG.

A Fase 1 do trik já está em `/opt/nodyx` como alterações **não commitadas**,
copiadas manualmente pra lá em algum momento anterior (não por este
processo). Este par de scripts existe pra levar as mudanças da Fase 2 (e
das seguintes) daqui pra lá do mesmo jeito: cópia direta de arquivo, não
git.

- Comunidade real rodando lá: "Instituto Kairos" (`NODYX_COMMUNITY_SLUG=trik004`).
- Banco: Postgres local, `DB_NAME=nodyx`, `DB_USER=nodyx_user` — credenciais
  em `/opt/nodyx/nodyx-core/.env` (legível sem sudo).
- PM2 roda como usuário `nodyx` (`PM2_HOME=/home/nodyx/.pm2`), processos
  `nodyx-core` (porta 3000) e `nodyx-frontend` (porta 4173), definidos em
  `/opt/nodyx/ecosystem.config.js`.
- O usuário do WSL (`orfeus`) tem sudo mas **pede senha** — não dá pra rodar
  `sudo` de forma não-interativa a partir do Claude Code. Por isso o fluxo é
  em duas partes.

## Fluxo

**1. Staging (não precisa de senha)** — roda a partir do Windows/Claude Code:

```powershell
wsl -d Ubuntu -e bash "/mnt/c/Users/fefeu/Documents/dev/trik-nodyx/scripts/wsl-local/stage.sh"
```

Isso copia a lista de arquivos em `stage.sh` (ver "Manutenção da lista"
abaixo) pra `/tmp/trik-fase2-deploy/` dentro do WSL — só leitura do repo,
escrita em `/tmp`, sem precisar de privilégio nenhum.

**2. Deploy (precisa de senha — rodar num terminal WSL de verdade)**:

```bash
sudo bash /mnt/c/Users/fefeu/Documents/dev/trik-nodyx/scripts/wsl-local/deploy.sh
```

Copia o staging pra `/opt/nodyx` (dono `nodyx:nodyx`), builda
`nodyx-core`+`nodyx-frontend` e reinicia via PM2 — mesmo padrão do
`nodyx-update` que já existe no WSL (`/usr/local/bin/nodyx-update`), só que
sem o `git pull` (não existe upstream compartilhado com este fork) e
restrito aos arquivos do trik em vez do repo inteiro.

## Reset do banco de teste (uma vez, ao migrar pra versão consolidada)

As migrations `trik_001`/`trik_002` foram consolidadas na forma final (sem
`CREATE` + `ALTER`/`RENAME`; a maestria foi pra dentro da `trik_002_xp.sql`).
Um banco que já rodou a versão antiga não reaplica migration registrada em
`schema_migrations`, então **antes do primeiro deploy desta versão** rode,
num terminal WSL (sem sudo, pede confirmação digitada):

```bash
bash /mnt/c/Users/fefeu/Documents/dev/trik-nodyx/scripts/wsl-local/reset-trik-db.sh
```

Apaga só as tabelas `trik_*` e os registros `trik%` de `schema_migrations`
(dados de teste do módulo RPG são perdidos; nada do nodyx é tocado). Em
instalação nova (produção) esse passo não existe — o boot do core cria tudo.

## Update do dia a dia (`update.sh`) — o que você quer na maioria das vezes

Leva o que mudou no fork pro servidor **sem resetar o banco e sem mexer no git de
`/opt/nodyx`** — jogadores, personagens, armas e seeds continuam como estão.
Num terminal WSL (pede a senha do sudo):

```bash
sudo bash /mnt/c/Users/fefeu/Documents/dev/trik-nodyx/scripts/wsl-local/update.sh
```

1. Confere que `/opt/nodyx` está na mesma base do fork (senão aborta — o staging só
   copia o que difere do commit do fork).
2. Staging (`stage.sh`, como o seu usuário).
3. `schema-patches.sql`: ajustes de schema idempotentes (ver abaixo).
4. `deploy.sh`: copia, builda e reinicia. **Pula o `npm ci`** quando o
   `package-lock.json` não mudou desde a última instalação (é o passo mais lento).
5. Espera o core responder e roda o `verify.sh`.

**Quando usar `full-reset.sh` em vez disso:** pra recomeçar do zero (banco limpo +
seeds), pra trazer o upstream novo, ou depois de **apagar arquivos** no fork — o
update só copia/sobrescreve, então um arquivo apagado aqui continua em `/opt/nodyx`.

**`schema-patches.sql`:** enquanto não há produção, mudança de schema edita
`trik_001`/`trik_002` direto, e o runner não reaplica migration já registrada. Um
banco que rodou a versão anterior precisa do ajuste equivalente; ele mora nesse
arquivo (idempotente — num banco recém-criado não faz nada). Ao editar uma
migration, acrescente o ajuste lá.

`stage.sh` + `deploy.sh` continuam servindo separados (staging sem sudo, depois
deploy) — o `update.sh` só os encadeia.

## Reset completo em um comando (`full-reset.sh`)

Zera o ambiente de teste e remonta tudo, incluindo o personagem de teste —
pra repetir testes do zero sem refazer `/registro` e `/plaquinha` na mão.
Num terminal WSL (pede a senha do sudo; sem `--yes` pede pra digitar `RESETAR`):

```bash
sudo bash /mnt/c/Users/fefeu/Documents/dev/trik-nodyx/scripts/wsl-local/full-reset.sh
```

O que faz, nesta ordem (qualquer falha aborta e diz em qual passo):

1. **Checa a base** — `git fetch` em `/opt/nodyx` e exige que o upstream seja o
   mesmo commit-base do fork (`nodyx-core`/`nodyx-frontend` idênticos). Se o
   upstream avançou, aborta **antes de destruir qualquer coisa**: sincronize o
   fork primeiro (o `stage.sh` só copia o que difere do commit do fork).
   Também roda o `stage.sh`.
2. **Backup** do banco inteiro em `/var/backups/nodyx-trik/*.dump` (`pg_restore`
   pra voltar).
3. **`/opt/nodyx`**: `git stash push -u` (todas as modificações ficam
   guardadas, nada é apagado de vez) e `git merge --ff-only` do upstream original
   (`Pokled/nodyx`). Roda como o usuário `nodyx` (dono do `.git`). O git vem antes
   do banco: se falhar, o banco continua intacto.
4. **Banco**: para o PM2 e roda `reset-trik-db.sh --yes` (só tabelas `trik_*` e
   os registros `trik%` de `schema_migrations`; `users`/`threads`/`posts`/`channels`
   não são tocados).
5. **`deploy.sh`**: copia o staging, builda e reinicia — o boot do core recria as
   tabelas a partir de `trik_001`/`trik_002`.
6. Espera o core subir e confere que as migrations aplicaram e que
   `trik_weapons.category` existe.
7. **Seeds** (`seed/*.sql`, em ordem) e `verify.sh`.

### Permissões do `/opt/nodyx`

`/opt/nodyx` é o clone do repo original de outro usuário, de propriedade do usuário
de sistema `nodyx` — não do seu. O `full-reset.sh` roda o git **como `nodyx`**, e isso
só funciona se tudo lá for do `nodyx`. Não é: `git pull` como root (o `nodyx-update`
faz isso), syncs feitos com sudo e o `install -D` do deploy deixam `.git/refs`,
arquivos rastreados e diretórios novos como `root`, e o `stash`/`merge` morrem com
`Permission denied`. Por isso o script começa devolvendo o dono (`chown nodyx`, só
metadado, pulando `node_modules`) e o `deploy.sh` corrige o dono dos diretórios que
cria. Rodar `nodyx-update` (root) de novo reintroduz o problema — o próximo
`full-reset.sh` conserta sozinho.

### Seeds (`seed/`)

Ficam **fora do git** (`.gitignore`): têm dados pessoais de teste. Cada arquivo é
idempotente (`ON CONFLICT DO NOTHING`) e roda depois que as tabelas existem:

- `01-canais.sql` — mapeamento dos canais `registro`, `plaquinhas` (plaquinha) e
  `progresso` (anúncios). O reset apaga `trik_channels`; sem isso o bot não
  reage a `/registro` e `/plaquinha` até remapear em `/admin/trik/channels`.
- `02-jahzell.sql` — jogador Orfeu (usuário `orfeus`) e o personagem Jahzell
  Khalid al-Filastini, com registro completo e plaquinha
  (`template_name`/`template_signature`).

Não entram (recadastrar pela UI a cada reset): tópicos habilitados pra XP
(`trik_threads`) e o catálogo de armas/matérias. Pra guardar um estado novo
(mais personagens, uma arma...), gere outro `.sql` em `seed/` a partir do banco.

## O que o staging copia

`stage.sh` **não usa mais uma lista manual**: ele copia tudo que, em
`nodyx-core` e `nodyx-frontend`, é diferente do último commit (arquivos
modificados + novos, respeitando o `.gitignore`). As correções do fork que
não são do módulo RPG (linkify, socket, layouts, locales, testes...) também
vão — elas melhoram o nodyx pra quem for jogar. Arquivo novo ou editado entra
sozinho; não precisa mexer no script.

Duas particularidades do git dentro do WSL sobre o mount do Windows, já
tratadas no script (não remova): `core.autocrlf=true` (o WSL não herda a
config global do Windows, e sem isso todo arquivo CRLF aparece como
modificado — foram 867 arquivos em vez de 74) e `diff --name-only HEAD` em vez
de `ls-files -m` (este só compara stat).

Como só o que difere do commit é copiado, `/opt/nodyx` precisa estar no mesmo
upstream do fork antes do deploy (`git pull --ff-only` lá). Se o fork mudou
um arquivo que o upstream também mudou depois, o deploy sobrescreve a versão
do upstream.

## Verificação pós-deploy

```bash
wsl -d Ubuntu -e bash "/mnt/c/Users/fefeu/Documents/dev/trik-nodyx/scripts/wsl-local/verify.sh"
```

Confere: migration aplicada, tabelas `trik_*` existem, curva de xp
(seed), backend/frontend respondendo (HTTP 200), rota nova protegida
(401 sem token). Não confere `pm2 list` (precisa sudo) — pra isso, rodar
manualmente:

```bash
sudo runuser -u nodyx -- env PM2_HOME=/home/nodyx/.pm2 pm2 list
```
