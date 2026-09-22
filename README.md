# Nespoli Concreto — Ponto e Pagamentos

Aplicativo privado de jornada, pagamentos e vales, preparado para Cloudflare Workers + D1.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/alexsandranany-crypto/nespoli-concreto-ponto-cloudflare)

## Implantar

1. Use o botão **Deploy to Cloudflare** acima.
2. Defina `APP_PASSWORD` com uma senha forte criada somente para este aplicativo.
3. Aguarde a criação automática do Worker e do banco D1.
4. Abra o endereço gerado, entre com a senha e use **Backup / Transferir → Restaurar por arquivo** para importar o backup particular.

Os dados de colaboradores, pontos, pagamentos e vales não fazem parte deste repositório.

## Segurança

- Todo o aplicativo exige login.
- A sessão usa cookie `HttpOnly`, `Secure` e `SameSite=Strict` com validade de 12 horas.
- A senha é armazenada pela Cloudflare como segredo e não fica no código.
- O banco D1 é criado dentro da conta Cloudflare da proprietária.
