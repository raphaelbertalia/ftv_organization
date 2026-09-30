# Recuperação de senha — FTV Hub

O pacote mantém a recuperação no endpoint `/api/auth`, usando duas actions:

- `request-password-reset`: recebe `{ email }` e envia um código de 6 dígitos.
- `confirm-password-reset`: recebe `{ email, code, new_password }` e altera a senha.

## Aplicar em um único deploy

1. Execute `sql/001_auth_codes.sql` no PostgreSQL usado pelo FTV Hub, antes de publicar o código. Ele cria `auth_codes` e `auth_code_rate_limits`; não apaga os dados atuais. O SQL pode ser executado novamente.
2. Substitua os cinco arquivos pelos correspondentes deste pacote:
   - `api/auth.js`
   - `lib/email.js`
   - `index.html`
   - `js/app.js`
   - `css/style.css`
3. Confira as variáveis existentes na Vercel: `DATABASE_URL`, `RESEND_API_KEY`, `EMAIL_FROM` e `APP_URL` (URL pública do app). O remetente precisa estar autorizado no Resend. Não há nova variável ou dependência npm obrigatória.
4. Faça um único deploy e teste com uma conta sua que tenha acesso ao e-mail cadastrado.

Os arquivos estão completos. `lib/auth.js`, `lib/db.js` e `api/reset.js` não precisam ser substituídos. A quantidade de arquivos em `/api` permanece igual. `sql/` e este guia não precisam entrar no deploy. As versões de cache de CSS e app.js no HTML foram incrementadas.

## Comportamento

- Login atual continua por usuário e senha. A senha preserva espaços, como no cadastro e na recuperação.
- O login existente estava depois da cadeia de actions; o bloco vazio permitia chegar até ele. Ele foi movido para uma função chamada explicitamente pela action `login`, mantendo bcrypt, migração de senha legada, sessão e grupos.
- “Esqueci minha senha” aparece no login; o cadastro também oferece recuperação e orienta a usar e-mail real.
- O código vale por 10 minutos, é guardado como hash bcrypt com custo 12 e pode ser usado uma vez. Reenviar substitui o código anterior.
- São permitidas cinco tentativas por código. Tentativas erradas são persistidas, sem bloquear o login normal da conta.
- Pedidos: intervalo de 60 segundos e até cinco por e-mail em uma hora; até 30 por IP em uma hora. Confirmações: até 60 por IP a cada 15 minutos. Os limites ficam no banco e funcionam entre instâncias da API.
- Pedido usa a mesma mensagem para conta ausente, inativa ou limite por e-mail atingido. Há um piso de tempo de resposta de 1,5 segundo para reduzir diferenças comuns; a duração do envio externo ainda pode variar. Isso não garante eliminar todas as diferenças de tempo.
- Falha no envio invalida apenas o código daquele pedido. O envio tem timeout de 10 segundos.
- Confirmação usa uma transação e bloqueia o usuário e o código antes de atualizar senha, consumir código e encerrar sessões anteriores. O código precisa corresponder ao e-mail atual da conta e a uma conta ativa.
- A API devolve o usuário somente depois da confirmação válida. O front preenche esse usuário e pede o login com a nova senha.
- Um e-mail avisa sobre a alteração. Falha nesse aviso não desfaz uma senha já alterada.
- Nova senha: mínimo de oito caracteres e até 72 bytes UTF-8, limite do bcrypt. Emojis e acentos podem ocupar mais de um byte.
- Quem cadastrou e-mail aleatório ou perdeu acesso à caixa postal deve procurar o administrador do grupo para conferir a conta. Este pacote não implementa alteração administrativa de e-mail nem mesclagem de contas.

## Conferência após deploy

1. Entre normalmente com uma conta existente e confira os grupos.
2. Saia, clique em “Esqueci minha senha” e informe seu e-mail.
3. Confira código e nome de usuário no e-mail, inclusive no spam.
4. Digite um código errado: a senha deve continuar igual.
5. Reenvie após 60 segundos: use o código do novo e-mail.
6. Confirme o código novo e a nova senha. Entre com o usuário preenchido e a nova senha.
7. Confira que a senha antiga e a sessão anterior deixaram de funcionar. Código já usado também deve ser recusado.
8. Confira a tela no celular e o atalho de recuperação no cadastro.

## Validação realizada no pacote

Sintaxe dos três arquivos JavaScript validada. Foram aprovadas 45 verificações da API com bcrypt real e banco/envio de e-mail simulados: login, migração legada, normalização, pedido genérico, cooldown, troca de senha, sessões, uso único, tentativas, expiração, reenvio, rollback, falha de envio e limite por IP. O fluxo do front foi validado com DOM e API simulados, incluindo navegação, validação, estados, falha, confirmação e preenchimento do usuário. IDs do HTML conferidos sem duplicidade.

Não foi feito deploy, acesso ao seu banco, envio real de e-mail ou teste visual em navegador. A verificação com seu banco/Resend e o teste no celular são os passos finais de integração.

Referências: [OWASP — Forgot Password](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html) e [Vercel — Request Headers](https://vercel.com/docs/headers/request-headers).

## Manutenção opcional

As tabelas mantêm o histórico mais recente de código por usuário/finalidade e os contadores de limite. Para limpar registros antigos durante manutenção, sem criar outra API:

```sql
DELETE FROM auth_codes
WHERE expires_at < NOW() - INTERVAL '7 days';

DELETE FROM auth_code_rate_limits
WHERE window_started_at < NOW() - INTERVAL '7 days';
```
