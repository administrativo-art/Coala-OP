# Rollout das contagens abertas de estoque

Status: preparado localmente, sem publicação.

## Contratos protegidos

- O provider global acompanha somente as contagens abertas do próprio usuário, limitado a 25 sessões mais um documento para detectar excesso.
- Acompanhamento de contagens de outras pessoas acontece apenas na tela de contagem, por API autenticada e limitada a 100 sessões por página.
- Somente o responsável recebe a sessão completa e pode continuar, concluir ou cancelar a contagem.
- O histórico deixa de depender do provider global. Ele é carregado somente na aba operacional, exige período de até 366 dias e usa páginas de até 100 sessões.
- A API aplica status, período, workspace e unidades autorizadas na consulta ao Firestore.
- Escritas diretas em `stockAuditSessions` são negadas; criação, atualização, conclusão e cancelamento passam pelas APIs do servidor.

## Preflight de custo

Não foi criado polling. Permanece um listener em tempo real filtrado pelo responsável e pelo status aberto.

### Provider global

Teto inicial por montagem: 26 leituras. Cenário conservador com uma montagem por hora, 20 usuários/abas, 10 horas por dia e 30 dias:

```text
26 × 1 × 20 × 10 × 30 = 156.000 leituras/mês
```

Cada alteração de uma sessão aberta é entregue somente ao listener do responsável. O volume incremental depende das edições e deve ser medido após o rollout.

### Lista operacional

Para perfis com até 30 unidades, cada página consulta no máximo 101 documentos. Perfis com 31 a 90 unidades usam de dois a três lotes de consulta, com teto de 303 leituras por página. Mais de 90 unidades falha de forma visível.

No cenário de 5 usuários, 0,5 carregamento por hora e 8 horas por dia:

```text
101 × 0,5 × 5 × 8 × 30 = 60.600 leituras/mês
```

### Histórico

O histórico abre com 30 dias e lê até 101 documentos por página para administrador ou perfil com até 30 unidades. Alterar período, unidade, status ou carregar outra página executa nova consulta. Não há atualização periódica.

```text
101 × 0,25 × 5 × 8 × 30 = 30.300 leituras/mês
```

## Permissões

- `stock.stockCount.view` ou compatibilidade `stock.audit.view`: consultar sessões pelas APIs.
- `stock.stockCount.perform`: iniciar e alterar a própria sessão.
- A unidade solicitada precisa pertencer ao escopo do perfil; administradores padrão mantêm acesso global.
- Leitura direta do Firestore por perfil comum fica restrita às próprias sessões; escritas diretas são negadas inclusive para administradores.

## Sequência de rollout

1. Publicar os quatro índices de `stockAuditSessions` no banco `coala` e aguardar o estado pronto.
2. Publicar as regras principais do Firestore.
3. Publicar a aplicação.
4. Confirmar que o responsável vê e continua a própria sessão.
5. Confirmar que um gestor vê sessões das unidades autorizadas somente como acompanhamento.
6. Confirmar que a aba de histórico abre 30 dias, filtra unidade/status e pagina.
7. Confirmar que chamada direta de escrita ao Firestore é negada.

Rollback da aplicação e das regras deve usar as revisões registradas no preflight. Os índices podem permanecer, pois não alteram dados nem autorização.
