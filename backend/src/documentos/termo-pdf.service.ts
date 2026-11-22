import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { dataHoraBR } from '../comum/util';
import { ArmazenamentoService } from '../vistorias/armazenamento.service';
import {
  AssinaturaTermo,
  ConteudoTermo,
  ParteTermo,
  ROTULO_METODO,
  ROTULO_RESULTADO_ITEM,
  ROTULO_RESULTADO_VISTORIA,
} from './termo';

const AZUL = '#0B2A5B';
const DOURADO = '#BF9B30';
const TINTA = '#1B2430';
const CINZA = '#5E6875';
const FIO = '#D9DEE5';
const COR_RESULTADO: Record<string, string> = {
  CONFORME: '#1E7B3A',
  RESSALVA: '#9A6A00',
  NAO_CONFORME: '#B3261E',
  NAO_SE_APLICA: CINZA,
};

// As fontes padrão do PDF só têm o alfabeto latino (WinAnsi). O que não cabe
// vira um equivalente simples em vez de um caractere quebrado.
function limpo(texto: string | null | undefined): string {
  return (texto ?? '')
    .replace(/→/g, '>')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF–—•…]/g, '?');
}

function cpfCnpj(v: string | null): string | null {
  const d = (v ?? '').replace(/\D/g, '');
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  return v;
}

function quando(iso: string | null | undefined): string {
  return iso ? dataHoraBR(new Date(iso)) : '—';
}

@Injectable()
export class TermoPdfService {
  constructor(private armazenamento: ArmazenamentoService) {}

  // Gera o PDF do termo. Com `assinaturas`, sai a versão assinada: o mesmo
  // conteúdo mais a página de assinaturas, que cita o hash do termo original.
  async gerar(
    c: ConteudoTermo,
    assinado?: { sha256Original: string; assinaturas: AssinaturaTermo[] },
  ): Promise<Buffer> {
    // As fotos são lidas antes: o pdfkit desenha de forma síncrona
    const fotos = new Map<string, Buffer>();
    for (const item of c.itens) {
      for (const chave of item.fotos) {
        try {
          fotos.set(chave, await this.armazenamento.ler(chave));
        } catch {
          // foto indisponível: o item sai sem ela
        }
      }
    }

    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 56, bottom: 64, left: 50, right: 50 },
      bufferPages: true,
      info: {
        Title: limpo(`${c.titulo} — ${c.protocolo}`),
        Author: 'RSF - SysEntrega',
        Subject: limpo(c.etapa),
      },
    });
    const partes: Buffer[] = [];
    doc.on('data', (b: Buffer) => partes.push(b));
    const fim = new Promise<Buffer>((resolve, reject) => {
      doc.on('end', () => resolve(Buffer.concat(partes)));
      doc.on('error', reject);
    });

    const largura = doc.page.width - 100;
    const x0 = 50;

    const espaco = (altura: number) => {
      if (doc.y + altura > doc.page.height - doc.page.margins.bottom) doc.addPage();
    };

    const secao = (titulo: string) => {
      espaco(60);
      doc.moveDown(0.9);
      doc.font('Helvetica-Bold').fontSize(8).fillColor(DOURADO)
        .text(limpo(titulo).toUpperCase(), x0, doc.y, { characterSpacing: 1.2 });
      const y = doc.y + 3;
      doc.moveTo(x0, y).lineTo(x0 + largura, y).lineWidth(0.6).strokeColor(FIO).stroke();
      doc.y = y + 8;
    };

    const campos = (pares: [string, string | null | undefined][]) => {
      const colunas = 2;
      const larguraColuna = largura / colunas;
      for (let i = 0; i < pares.length; i += colunas) {
        espaco(34);
        const y = doc.y;
        let maior = y;
        for (let j = 0; j < colunas && i + j < pares.length; j++) {
          const [rotulo, valor] = pares[i + j];
          const x = x0 + j * larguraColuna;
          doc.font('Helvetica').fontSize(7.5).fillColor(CINZA)
            .text(limpo(rotulo), x, y, { width: larguraColuna - 12 });
          doc.font('Helvetica-Bold').fontSize(10).fillColor(TINTA)
            .text(limpo(valor) || '—', x, doc.y + 1, { width: larguraColuna - 12 });
          maior = Math.max(maior, doc.y);
        }
        doc.y = maior + 7;
      }
    };

    const parte = (p: ParteTermo): [string, string | null][] => [
      [p.parte, p.nome],
      [p.documento && p.documento.replace(/\D/g, '').length === 11 ? 'CPF' : 'CNPJ', cpfCnpj(p.documento)],
      ...(p.representante ? ([['Representante', p.representante]] as [string, string][]) : []),
    ];

    // ---------- cabeçalho ----------
    doc.rect(0, 0, doc.page.width, 96).fill(AZUL);
    doc.rect(0, 96, doc.page.width, 3).fill(DOURADO);
    doc.font('Helvetica-Bold').fontSize(9).fillColor(DOURADO)
      .text('RSF · SYSENTREGA', x0, 26, { characterSpacing: 1.5 });
    doc.font('Helvetica-Bold').fontSize(16).fillColor('#FFFFFF')
      .text(limpo(c.titulo), x0, 42, { width: largura });
    doc.font('Helvetica').fontSize(9).fillColor('#C9D3E3')
      .text(limpo(`Protocolo ${c.protocolo}  ·  Emitido em ${quando(c.emitidoEm)}`), x0, doc.y + 4);
    doc.y = 112;

    secao('Unidade');
    campos([
      ['Empreendimento', `${c.empreendimento.nome} (${c.empreendimento.codigo})`],
      ['Unidade', c.unidade.bloco ? `${c.unidade.bloco} · ${c.unidade.numero}` : c.unidade.numero],
      ['Endereço', c.empreendimento.endereco],
      ['Andar / Tipologia', [c.unidade.andar, c.unidade.tipologia].filter(Boolean).join(' · ')],
      ['Etapa', c.etapa],
    ]);

    secao('Quem entrega');
    campos(parte(c.cedente));
    secao('Quem recebe');
    campos(parte(c.recebedor));

    secao(c.vistoria.nome);
    campos([
      ['Resultado', ROTULO_RESULTADO_VISTORIA[c.vistoria.resultado] ?? c.vistoria.resultado],
      ['Itens conformes', `${c.vistoria.conformes} de ${c.vistoria.aplicaveis} aplicáveis`],
      ['Realizada por', c.vistoria.vistoriador],
      ['Acompanhada por', c.vistoria.acompanhante],
      ['Início', quando(c.vistoria.iniciadaEm)],
      ['Conclusão', quando(c.vistoria.concluidaEm)],
      ...(c.vistoria.agendadaPara
        ? ([['Agendada para', quando(c.vistoria.agendadaPara)]] as [string, string][])
        : []),
    ]);
    if (c.vistoria.observacoes) {
      doc.font('Helvetica').fontSize(7.5).fillColor(CINZA).text('Observações gerais', x0);
      doc.font('Helvetica').fontSize(9.5).fillColor(TINTA)
        .text(limpo(c.vistoria.observacoes), x0, doc.y + 1, { width: largura });
    }

    // ---------- itens ----------
    secao('Itens verificados');
    let ambiente = '';
    for (const item of c.itens) {
      if (item.ambiente !== ambiente) {
        ambiente = item.ambiente;
        espaco(46);
        doc.moveDown(0.4);
        doc.font('Helvetica-Bold').fontSize(10).fillColor(AZUL).text(limpo(ambiente), x0);
        doc.moveDown(0.2);
      }
      espaco(26);
      const y = doc.y;
      doc.font('Helvetica-Bold').fontSize(8.5)
        .fillColor(COR_RESULTADO[item.resultado] ?? TINTA)
        .text(limpo(ROTULO_RESULTADO_ITEM[item.resultado] ?? item.resultado), x0 + largura - 90, y, {
          width: 90,
          align: 'right',
        });
      doc.font('Helvetica').fontSize(9.5).fillColor(TINTA)
        .text(limpo(item.descricao), x0, y, { width: largura - 100 });
      if (item.observacao) {
        doc.font('Helvetica-Oblique').fontSize(8.5).fillColor(CINZA)
          .text(limpo(item.observacao), x0 + 10, doc.y + 1, { width: largura - 110 });
      }
      const imagens = item.fotos.map((f) => fotos.get(f)).filter(Boolean) as Buffer[];
      if (imagens.length) {
        const porLinha = 3;
        const larguraFoto = (largura - 10 * (porLinha - 1)) / porLinha;
        const alturaFoto = larguraFoto * 0.75;
        for (let i = 0; i < imagens.length; i += porLinha) {
          espaco(alturaFoto + 12);
          const yFoto = doc.y + 5;
          imagens.slice(i, i + porLinha).forEach((img, j) => {
            try {
              doc.image(img, x0 + j * (larguraFoto + 10), yFoto, {
                fit: [larguraFoto, alturaFoto],
              });
            } catch {
              // imagem que o pdfkit não lê: segue sem ela
            }
          });
          doc.y = yFoto + alturaFoto + 4;
        }
      }
      const yFio = doc.y + 3;
      doc.moveTo(x0, yFio).lineTo(x0 + largura, yFio).lineWidth(0.4).strokeColor(FIO).stroke();
      doc.y = yFio + 5;
    }

    if (c.pendenciasSanadas.length) {
      secao('Pendências de vistorias anteriores, sanadas');
      for (const p of c.pendenciasSanadas) {
        espaco(40);
        doc.font('Helvetica-Bold').fontSize(9.5).fillColor(TINTA)
          .text(limpo(p.descricao), x0, doc.y, { width: largura });
        doc.font('Helvetica').fontSize(8.5).fillColor(CINZA)
          .text(
            limpo(`Resolução: ${p.resolucao} — ${p.resolvidaPor}, ${quando(p.resolvidaEm)}`),
            x0 + 10,
            doc.y + 1,
            { width: largura - 10 },
          );
        doc.moveDown(0.4);
      }
    }

    secao('Declaração de aceite');
    espaco(70);
    doc.font('Helvetica').fontSize(10).fillColor(TINTA)
      .text(limpo(c.declaracao), x0, doc.y, { width: largura, align: 'justify', lineGap: 2 });

    // ---------- página de assinaturas ----------
    if (assinado) {
      doc.addPage();
      doc.font('Helvetica-Bold').fontSize(14).fillColor(AZUL).text('Assinaturas eletrônicas', x0, 56);
      doc.moveDown(0.3);
      doc.font('Helvetica').fontSize(9).fillColor(CINZA).text(
        limpo(
          'As partes abaixo assinaram eletronicamente o termo cujo conteúdo é identificado pelo hash ' +
            'SHA-256 a seguir. Qualquer alteração no documento original produz um hash diferente.',
        ),
        { width: largura },
      );
      doc.moveDown(0.5);
      doc.font('Courier').fontSize(8.5).fillColor(TINTA).text(assinado.sha256Original, { width: largura });
      for (const a of assinado.assinaturas) {
        secao(a.parte);
        const yInicio = doc.y;
        if (a.assinaturaImagem) {
          try {
            const base64 = a.assinaturaImagem.slice(a.assinaturaImagem.indexOf(',') + 1);
            doc.image(Buffer.from(base64, 'base64'), x0 + largura - 170, yInicio, {
              fit: [170, 70],
            });
          } catch {
            // rubrica ilegível: os demais elementos de prova permanecem
          }
        }
        const linhas: [string, string | null][] = [
          ['Nome', a.nome],
          ['CPF', cpfCnpj(a.cpf)],
          ['Assinado em', quando(a.assinadoEm)],
          ['Método', ROTULO_METODO[a.metodo] ?? a.metodo],
          ['IP', a.ip],
          ['Localização', a.localizacao],
          ['Navegador', a.userAgent ? a.userAgent.slice(0, 110) : null],
        ];
        for (const [rotulo, valor] of linhas) {
          if (!valor) continue;
          const y = doc.y;
          doc.font('Helvetica').fontSize(8).fillColor(CINZA).text(limpo(rotulo), x0, y, { width: 80 });
          doc.font('Helvetica').fontSize(9).fillColor(TINTA)
            .text(limpo(valor), x0 + 82, y, { width: largura - 82 - 180 });
          doc.y = Math.max(doc.y, y + 12) + 2;
        }
        doc.y = Math.max(doc.y, yInicio + 76);
      }
    }

    // ---------- rodapé em todas as páginas ----------
    const paginas = doc.bufferedPageRange();
    const site = (process.env.APP_URL || '').replace(/\/$/, '');
    for (let i = 0; i < paginas.count; i++) {
      doc.switchToPage(paginas.start + i);
      // Sem isto, escrever abaixo da margem abriria uma página nova
      doc.page.margins.bottom = 0;
      const y = doc.page.height - 46;
      doc.moveTo(x0, y).lineTo(x0 + largura, y).lineWidth(0.5).strokeColor(FIO).stroke();
      doc.font('Helvetica').fontSize(7.5).fillColor(CINZA).text(
        limpo(
          `Protocolo ${c.protocolo}` +
            (site ? `  ·  Confira em ${site}/verificar` : '') +
            (assinado ? '  ·  Documento assinado eletronicamente' : ''),
        ),
        x0,
        y + 6,
        { width: largura - 60, lineBreak: false },
      );
      doc.text(`${i + 1} / ${paginas.count}`, x0 + largura - 60, y + 6, {
        width: 60,
        align: 'right',
        lineBreak: false,
      });
    }

    doc.end();
    return fim;
  }
}
