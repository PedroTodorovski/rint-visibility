# Mapa do motor de diagnóstico

> Documento didático, sem jargão técnico. Objetivo: qualquer pessoa consegue abrir este arquivo e entender, do início ao fim, como o motor decide o que mostrar para o fundador — desde o clique que pede um diagnóstico até a única resposta final que ele recebe.
>
> Este mapa descreve fielmente o que o código faz hoje. Cada bifurcação aqui corresponde a uma condição real no motor (`rint-visibility`). Para a versão técnica completa (nomes de função, linhas de código, casos de teste), ver [`rint-app/docs/DIAGNOSIS-DOMINANT.md`](../../rint-app/docs/DIAGNOSIS-DOMINANT.md) e [`GEMINI-PROBE-METHODOLOGY.md`](./GEMINI-PROBE-METHODOLOGY.md).

---

## Como ler este mapa

Nos diagramas abaixo:

- **Losango** `{ }` = uma pergunta que o motor responde sozinho (sim/não).
- **Retângulo** `[ ]` = uma ação ou um resultado.
- **Retângulo com borda dupla** = um dos 4 destinos finais possíveis (a "causa da semana").

Alguns termos técnicos viram nome de negócio aqui. Tabela de tradução:

| No código | Neste mapa | O que é de verdade |
|---|---|---|
| SKU | Produto | Um produto específico sendo testado — uma URL de página de produto |
| Coerência | "A resposta bate com a loja" | Se preço/marca que a IA citou batem com o cadastro real |
| Citação / "cliente foi citado" | "A IA te citou como fonte" | A loja apareceu como referência na resposta |
| Grounding | "As fontes que a IA consultou" | Os links que o Google Search (usado pela IA) realmente leu |
| JSON-LD / schema | "Ficha técnica legível por máquina" | Um bloco de dados estruturados na página que a IA lê direto, sem precisar interpretar texto solto |
| Retrato do dia (day photo) | "Aproveitar o que já foi medido hoje" | Cache que evita perguntar a mesma coisa duas vezes no mesmo dia |
| Job | Trabalho / diagnóstico | Uma execução completa do motor, do pedido até a resposta |
| Track / trilha | Trilha | Cada uma das 4 causas possíveis da semana |
| SKU dominante | Produto da semana | O produto escolhido para representar todo o diagnóstico |

---

## 1. Visão geral — do pedido à resposta

```mermaid
flowchart TD
    A[Fundador pede um diagnóstico] --> B{Já existe um retrato\nidêntico feito hoje?}
    B -->|Sim| Z1[Devolve o mesmo resultado\nna hora — sem gastar\numa chamada nova]
    B -->|Não| C[Confere se há produtos\ne perguntas suficientes\npara rodar]
    C -->|Falta algo| ZE[Erro — o diagnóstico\nnem começa]
    C -->|Ok| D[Para cada produto:\na porta pública está aberta?]
    D -->|Fechada| E1[Pula direto —\na causa já é conhecida]
    D -->|Aberta| E2[Faz a rodada de\nperguntas ao Gemini]
    E1 --> F[Escolhe o produto\nque representa a semana]
    E2 --> F
    F --> G[Busca dados financeiros:\nGA4, Shopify, Meta...]
    G --> H[Roda a árvore de decisão]
    H --> I1[["Trilha Conteúdo"]]
    H --> I2[["Trilha Página"]]
    H --> I3[["Trilha Produto"]]
    H --> I4[["Trilha Mídia"]]
    I1 --> J[Calcula o tamanho\ndo prejuízo em R$]
    I2 --> J
    I3 --> J
    I4 --> J
    J --> K[Salva tudo e\navisa por webhook]
    K --> L[Fundador recebe\numa das 4 respostas]
```

As seções a seguir abrem cada caixa deste mapa.

---

## 2. Antes de perguntar pra IA

Antes de gastar uma única chamada ao Gemini, o motor confere se vale a pena rodar de novo.

```mermaid
flowchart TD
    A[Pedido de diagnóstico chega] --> B["Monta a 'impressão digital'\ndo conjunto: quais produtos\n+ quais perguntas estão ativos"]
    B --> C{Existe um trabalho\nconcluído hoje com a\nmesma impressão digital?}
    C -->|Sim| D[Devolve o trabalho antigo —\nmesma resposta, sem\nrodar de novo]
    C -->|Não| E{Tem pelo menos\n1 produto cadastrado?}
    E -->|Não| F1[Erro de validação —\npara aqui]
    E -->|Sim| G{Tem pelo menos\n1 pergunta ativa?}
    G -->|Não| F1
    G -->|Sim| H{A URL de cada produto\nparece mesmo a página\nde um produto?}
    H -->|"Não — home, vídeo,\nrede social, blog,\nnotícia, busca..."| F1
    H -->|Sim| I{Dentro do limite de\nprodutos e perguntas\ndo plano atual?}
    I -->|Não| F1
    I -->|Sim| J[Cria o trabalho\ne começa a rodar]
```

Duas ideias importantes aqui:

- **"Impressão digital" do dia** — se o fundador roda o diagnóstico duas vezes no mesmo dia (fuso de São Paulo) com exatamente o mesmo conjunto de produtos e perguntas ativas, o motor não gasta uma chamada nova: devolve o resultado que já existe. Uma pergunta nova ou um produto novo já muda a impressão digital e libera uma rodada nova.
- **Página não pode ser qualquer link.** O motor recusa colar a home da loja, um vídeo, uma rede social, um blog, uma notícia, uma página de busca ou de categoria como se fosse a página de um produto — mesmo que o texto pareça convincente, se o link não parece a página de um produto específico, o diagnóstico nem começa. Mercado Livre e Amazon são aceitos.

---

## 3. A porta da loja está aberta?

Para cada produto, antes de gastar uma pergunta com a IA, o motor confere se a página pública do produto está acessível — porque se a porta está fechada, perguntar pra IA não muda a causa: a IA também não consegue entrar.

```mermaid
flowchart TD
    A[Tira uma foto do estado\npúblico da loja para\neste produto] --> B{A página pede senha\nou está bloqueada?}
    B -->|Sim| C[Porta fechada]
    B -->|Não| D{Já conseguimos checar\na página pública\nalguma vez?}
    D -->|"Nunca — só temos\ndado antigo do painel"| C
    D -->|Sim, já checamos| E[Porta aberta]
    C --> F["Este produto NÃO entra\nna rodada de perguntas —\na causa já é conhecida\n(vira Trilha Página)"]
    E --> G[Este produto entra\nna rodada de perguntas]
```

Produtos com a porta fechada pulam direto para a Trilha Página — não faz sentido gastar uma pergunta na IA quando a causa já está clara.

---

## 4. A rodada de perguntas ao Gemini

Para cada produto com a porta aberta, o motor passa por todas as perguntas cadastradas para aquele produto.

```mermaid
flowchart TD
    A[Para cada pergunta\nativa deste produto] --> B{Já existe uma resposta\npara esta mesma dupla\nproduto + pergunta,\nmedida hoje?}
    B -->|Sim| C["Copia a evidência —\nnão gasta uma chamada nova\n('retrato do dia')"]
    B -->|Não| D[Pergunta pro Gemini]
    D --> E{A IA citou a loja\ncomo fonte da resposta?}
    E -->|Sim| F[Marca como citado]
    E -->|"Não, mas a marca\naparece no texto\nsem link de compra"| G[Dispara 1 pergunta\nextra pedindo\no link da loja]
    E -->|"Não, e nem\nmencionou a marca"| H[Marca como\nnão citado]
    G --> I[Usa essa resposta\nextra para decidir\nse cita ou não]
    F --> J[Guarda o resultado\ndesta pergunta]
    H --> J
    I --> J
    C --> J
```

Duas regras que evitam gastar chamadas à toa:

- **Retrato do dia por dupla produto+pergunta.** Se a mesma pergunta já foi feita hoje para o mesmo produto (ignorando maiúsculas, acentos e espaços extras), o motor copia a resposta e o horário em que foi medida — não pergunta de novo.
- **Um único "puxão" de confirmação.** Se a resposta da IA menciona a marca no texto mas não mostra o link de compra da loja, o motor faz **uma** pergunta extra, direcionada, pedindo especificamente o link. Isso evita julgar "não citou" quando a IA só esqueceu de linkar.

---

## 5. Qual produto representa o diagnóstico da semana

Um diagnóstico foca em **um único produto** por rodada — mesmo que vários tenham sido testados.

```mermaid
flowchart TD
    A[Depois de rodar todas\nas perguntas de todos\nos produtos] --> B{Algum produto\ntem a porta fechada?}
    B -->|Sim| C[Esse produto vence\nautomaticamente —\na causa já está clara]
    B -->|Não| D["Calcula uma pontuação\npor produto:\n(perguntas sem citação × 3)\n+ (concorrente citado × 2)"]
    D --> E[O produto com maior\npontuação vence — é o\nque tem mais lacuna\nde visibilidade]
    C --> F[Esse é o\nproduto da semana]
    E --> F
```

A porta fechada sempre ganha na hora — não tem por que comparar pontuação quando já sabemos que o problema é acesso.

---

## 6. A árvore de decisão — qual é a causa desta semana

Este é o núcleo do motor: uma cadeia de perguntas respondida **em ordem**. A primeira pergunta que der "sim" decide a trilha — as seguintes nem são avaliadas. Só existe **uma** causa por diagnóstico.

```mermaid
flowchart TD
    A[Produto da semana] --> B{A porta pública\nestá fechada?}
    B -->|Sim| PAGINA1[["Trilha Página\n(porta fechada)"]]
    B -->|Não| C{"A loja está ligada,\nmas este produto não\nestá cadastrado nela\n— e não é um marketplace\nconhecido (Mercado Livre/Amazon)?"}
    C -->|Sim| PAGINA2[["Trilha Página\n(produto fora do painel)"]]
    C -->|Não| D{"A resposta da IA é\nincoerente — preço ou\nmarca citados não batem\ncom o que a loja\nrealmente vende?"}
    D -->|Sim| CONTEUDO1[["Trilha Conteúdo\n(resposta incoerente)"]]
    D -->|Não| E{"A IA citou você em\nmenos perguntas do que\no total — incluindo\nzero de todas?"}
    E -->|Sim| CONTEUDO2[["Trilha Conteúdo\n(pouca ou nenhuma citação)"]]
    E -->|"Não — citou\nem todas"| F{A página pública expõe\na ficha técnica que\na IA consegue ler?}
    F -->|"Não, ou nunca\nverificamos"| PAGINA3[["Trilha Página\n(ficha ausente)"]]
    F -->|Sim| G{"Os atributos que a IA\ncitou não batem com o\ncadastro, OU o cadastro\nem si é raso (poucos\natributos/descrição curta)?"}
    G -->|Sim| CONTEUDO3[["Trilha Conteúdo\n(atributos não batem\nou cadastro raso)"]]
    G -->|Não| H{A IA citou um\nconcorrente específico\nno lugar de você?}
    H -->|Sim| PRODUTO[["Trilha Produto"]]
    H -->|Não| I{"O anúncio no Meta está\ndoente — gastou sem\nvender, ou custo por\nvenda acima do preço\ndo produto?"}
    I -->|Sim| MIDIA[["Trilha Mídia"]]
    I -->|Não| PAGINA4[["Trilha Página\n(sobra — nada mais bateu)"]]

    classDef conteudo fill:#fef3c7,stroke:#b45309,color:#78350f;
    classDef pagina fill:#dbeafe,stroke:#1d4ed8,color:#1e3a8a;
    classDef produto fill:#dcfce7,stroke:#15803d,color:#14532d;
    classDef midia fill:#fee2e2,stroke:#b91c1c,color:#7f1d1d;
    class CONTEUDO1,CONTEUDO2,CONTEUDO3 conteudo;
    class PAGINA1,PAGINA2,PAGINA3,PAGINA4 pagina;
    class PRODUTO produto;
    class MIDIA midia;
```

Duas notas de leitura importantes:

- **Se a IA nunca citou você em nenhuma pergunta, não existe "resposta incoerente"** — sem te citar, não tem preço nem marca pra comparar. Nesse caso a árvore pula direto da pergunta de coerência para a de "quantas vezes te citou" (que já vai dar sim, porque 0 é menos que o total).
- **"Produto antes de Mídia" é proposital.** Se a IA já citou você em todas as perguntas, a página técnica está ok, mas ela escolheu um concorrente específico, a causa é Produto — mesmo que o anúncio no Meta também esteja gastando mal. Não faz sentido aumentar a verba de um produto que a própria IA já rejeitou.

---

## 7. As 4 trilhas — o que cada uma realmente vira

Depois que a árvore escolhe a trilha, o motor monta **uma única ação da semana** — nunca uma lista de tarefas.

### 🟡 Trilha Conteúdo — "a IA não te conhece direito"

A ação sempre passa por uma pergunta primeiro: o cadastro deste produto na loja já tem informação suficiente pra sustentar um conteúdo, ou precisa ser completado antes?

```mermaid
flowchart TD
    A[Trilha Conteúdo] --> B{O cadastro deste produto\ntem descrição útil e\npelo menos 3 atributos\ntécnicos preenchidos?}
    B -->|Não| M1["Ação começa no cadastro\nda loja: completar o que\nfalta primeiro — o conteúdo\nespera até isso existir"]
    B -->|Sim| C{A IA já leu alguma\npágina própria de\nconteúdo da loja?}
    C -->|Sim| M2["Ação: melhorar essa\npágina existente e\nreforçar o link para\no produto"]
    C -->|Não| D{Existe uma página\nprópria relevante para\no tema, mesmo que a\nIA não tenha lido ainda?}
    D -->|Sim| M2
    D -->|Não| M3["Ação: criar uma página\nnova de conteúdo/\ncomparativo sobre o tema"]
```

Regras que valem sempre nesta trilha:

- A ação nunca copia um atributo que o concorrente tem e a loja **não** tem — isso seria "mentir no cadastro". Se o fato não pertence a este produto, o gap é aceito, não maquiado.
- A frase final passa por uma camada de reescrita com um modelo de IA mais simples, só para deixar o texto mais claro para o fundador — essa camada não decide nada (não escolhe URL, não inventa fato); se ela tentar inventar algo, o motor descarta e usa uma frase padrão determinística no lugar.
- Nunca vira uma lista de pautas de blog nem um slogan genérico — sempre um único parágrafo de ação concreta.

**Exemplo real:** *"Crie uma landing editorial/comparativa no domínio da loja (...) sobre suplemento de greens no Brasil, como alternativa ao que a IA citou. Use o que a loja já tem (...). Não escreva Certificação NSF — o produto não tem. A IA leu review e a loja de outra marca, não a sua ficha."*

### 🔵 Trilha Página — "a porta técnica está travada"

```mermaid
flowchart TD
    A[Trilha Página] --> B{Página pede senha?}
    B -->|Sim| M1[Ação: tirar\na senha]
    B -->|Não| C{Página está\nbloqueada?}
    C -->|Sim| M2[Ação: tirar\no bloqueio]
    C -->|Não| D{"Loja ligada, mas este\nproduto está registrado\nem outro painel — não é\nmarketplace conhecido?"}
    D -->|Sim| M3[Ação: ligar a URL\ncerta à loja no painel]
    D -->|Não| E{Ainda não conseguimos\nverificar se a página\né mesmo pública?}
    E -->|Sim| M4[Ação: confirmar que\na página está pública]
    E -->|Não| F{A página está aberta,\nmas sem a ficha técnica\nlegível pela IA?}
    F -->|Sim| M5[Ação: expor\na ficha técnica]
    F -->|Não| M6[Não é esta a causa —\na página está ok]
```

Esta trilha nunca vira uma lista genérica de SEO (FAQ, canonical, robots.txt) — é sempre um único movimento técnico e objetivo.

**Exemplo real (senha):** *"Esta URL está com senha. Sem a porta aberta, a IA não lê o produto. Esta semana: tire a senha da página do produto."*

**Exemplo real (sem ficha técnica):** *"O cadastro no Shopify já tem o produto. A página pública não expõe a ficha estruturada. Esta semana: exponha essa ficha em [URL do produto]."*

### 🟢 Trilha Produto — "o concorrente venceu na comparação"

Aqui o motor compara o produto da loja com o que a IA escolheu no lugar dele, numa ordem fixa de prioridade — a primeira diferença que for **real o suficiente** (não um empate técnico) vence e vira o passo da semana.

```mermaid
flowchart TD
    A[Trilha Produto] --> B{"Diferença de preço real\n— mesma moeda, mesma\nunidade, 15% ou mais?"}
    B -->|Sim| M1[Passo da semana: preço]
    B -->|Não| C{"Diferença de avaliação\nreal — os dois com nota,\n0,4 estrela ou mais?"}
    C -->|Sim| M2[Passo da semana: avaliação]
    C -->|Não| D{Concorrente tem um selo,\ncertificação ou fórmula\nque a loja não declara?}
    D -->|Sim| M3[Passo da semana: composição]
    D -->|Não| E{Tamanho ou dose\nrealmente diferentes?}
    E -->|Sim| M4[Passo da semana: tamanho]
    E -->|Não| F{Embalagem\nrealmente diferente?}
    F -->|Sim| M5[Passo da semana: embalagem]
    F -->|Não| M6[Nenhuma diferença real\nencontrada — aceitar\na diferença como está]
```

Duas travas evitam conclusões precipitadas:

- **Diferença pequena não compete.** 4,6 estrelas contra 4,8, ou um preço 3% mais caro, não é o motivo real de uma venda perdida — o motor ignora e passa pro próximo critério.
- **Sem oferta clara do concorrente, o motor espera.** Se a IA citou um concorrente mas sem produto específico, sem loja, ou de forma contraditória entre as várias perguntas, o motor não inventa uma comparação — marca que precisa de mais dados e não aponta um "vencedor" nesta rodada.

**Exemplo real:** *"Não foi o preço nem o prazo: ela escolheu o outro pela fórmula (Certificação NSF). Esta semana: não mude o produto e não copie a certificação no cadastro."*

### 🔴 Trilha Mídia — "o anúncio está desperdiçando dinheiro"

```mermaid
flowchart TD
    A[Trilha Mídia] --> B{Gastou no Meta\ne vendeu zero unidades?}
    B -->|Sim| M1["Ação: pausar o anúncio\ndeste produto — confirmar\nse a venda está sendo\nmedida corretamente"]
    B -->|Não| C{Custo por venda\nficou acima do preço\ndo produto na loja?}
    C -->|Sim| M2["Ação: não aumentar\na verba — pedir para\nreduzir o lance ou\npausar até o custo\nbaixar"]
```

Só conta o Meta convencional (feed, Stories, catálogo) — Google Ads, Merchant Center e anúncios dentro de ferramentas de IA ainda não decidem a causa da semana (ficam para uma fase futura). Conteúdo e mudança de produto não resolvem um anúncio que não está vendendo — por isso, quando esta trilha é a causa, a ação é sempre na própria conta de mídia.

---

## 8. O tamanho do prejuízo

Em paralelo à árvore de decisão, o motor sempre calcula dois números — eles aparecem em qualquer uma das 4 trilhas, porque medem o impacto financeiro, não a causa.

1. **Lacuna em R$** — compara, na receita que a IA está gerando para a loja, a proporção de vezes que um concorrente foi citado contra a proporção de vezes que você foi citado. Se a IA nunca te citou em nenhuma pergunta, o cálculo usa o total de perguntas como base (pra não dividir por zero) — o número nunca fica negativo; é sempre um "piso" do prejuízo, nunca um teto.
2. **Clientes perdidos** — a lacuna em R$ dividida pelo ticket médio da loja. Uma estimativa de quantos clientes essa lacuna representa.
3. **Custo para compensar via mídia** — clientes perdidos × custo por venda no Meta. É a resposta para "quanto custaria comprar de volta, via anúncio, o que a visibilidade orgânica não está trazendo". **Não deve ser somado com a lacuna** — são duas óticas diferentes (quanto se perde vs. quanto custaria recuperar via anúncio).

---

## 9. Fim da linha

```mermaid
flowchart TD
    A[Diagnóstico terminou\nde processar] --> B{Deu tudo certo?}
    B -->|Sim| C[Salva o texto final +\nos números de prejuízo]
    C --> D[Marca o trabalho\ncomo concluído]
    D --> E["Avisa por webhook:\n'diagnóstico pronto'"]
    B -->|"Não — erro\nem qualquer etapa"| F[Marca o trabalho como\nfalho, com a mensagem\ndo erro]
    F --> G["Avisa por webhook:\n'diagnóstico falhou'"]
    H["Trabalho ficou 'rodando'\npor mais de 15 minutos\nsem terminar"] --> I[Na próxima vez que\nalguém consultar, o\nsistema marca sozinho\ncomo falho]
    J[O serviço do motor\nreiniciou no meio\nde um trabalho] --> K[Todo trabalho que estava\nem andamento é marcado\ncomo falho na hora]
```

A mensagem que o fundador vê quando um trabalho trava sozinho é sempre a mesma: *"O diagnóstico parou antes de terminar. Tente de novo."*

---

## Onde cada peça deste mapa vive no código

| Seção deste mapa | Arquivo |
|---|---|
| Pedido + retrato do dia | `src/routes/v1/diagnostics.ts`, `src/services/day-photo.ts` |
| Validações de entrada | `src/services/diagnostic-input.ts` |
| Porta da loja aberta/fechada | `src/services/diagnostic-triage.ts` (`publicStorefrontUnreadable`) |
| Rodada de perguntas ao Gemini | `src/services/dominant-diagnostic-runner.ts` (`executeQuery`) |
| Produto da semana | `src/services/dominant-diagnostic-runner.ts` (`selectPrimarySku`, `selectDominantSku`) |
| Árvore de decisão | `src/services/diagnostic-triage.ts` (`computeTriage`) |
| Trilha Conteúdo | `src/services/llm-out-first-action.ts`, `src/services/founder-action-copy.ts` |
| Trilha Página | `src/services/pdp-week-judge.ts`, `src/services/pdp-out-first-action.ts` |
| Trilha Produto | `src/services/produto-week-judge.ts`, `src/services/produto-out-first-action.ts` |
| Trilha Mídia | `src/services/diagnostic-output.ts` (bloco final de `buildDiagnosticOutput`) |
| Tamanho do prejuízo | `src/services/revenue-gap-engine.ts` |
| Fim da linha / travas | `src/services/dominant-diagnostic-runner.ts` (`try/catch` final), `src/services/diagnostic-job-stale.ts` |

Para a lógica de roteamento na versão técnica completa (com nomes de função, ADRs e casos de teste), ver [`rint-app/docs/DIAGNOSIS-DOMINANT.md`](../../rint-app/docs/DIAGNOSIS-DOMINANT.md).
