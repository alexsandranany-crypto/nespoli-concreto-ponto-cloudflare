# Nespoli Concreto — Ponto e Pagamentos

Aplicativo privado de jornada, pagamentos, vales e fichas cadastrais de colaboradores, preparado para Cloudflare Workers + D1.

Os atalhos de fechamento separam os ciclos em 22–07 e 08–21, evitando repetir no novo período a diária já encerrada no dia 21.

Quando a diária do dia 21 já tiver sido paga antes do fim da jornada, o modo “Diária já paga” calcula apenas o saldo acima ou abaixo de 8 horas e leva esse saldo para o ciclo 22–07.

Vales têm situação “Não pago” ou “Pago/descontado”. Ao finalizar o pagamento de um colaborador, os vales não pagos daquele período recebem a mesma data do pagamento. Na migração, os vales de 04/09/2026 a 21/09/2026 são identificados como pagos/descontados em 21/09/2026.

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
- Documentos, endereços e dados bancários ficam fora dos relatórios de pagamento e do texto do WhatsApp.
- O arquivo de backup contém dados pessoais e deve ser guardado em local seguro.
