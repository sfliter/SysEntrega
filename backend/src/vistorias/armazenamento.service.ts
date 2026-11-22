import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';

// Arquivos do sistema (fotos de vistoria e termos em PDF) em disco, num
// volume do Docker. As chaves são geradas aqui dentro — nunca vêm do usuário.
// Para trocar por S3/MinIO, basta reimplementar estes três métodos.
@Injectable()
export class ArmazenamentoService {
  private raiz = path.resolve(process.env.ARMAZENAMENTO_DIR || './armazenamento');

  private caminho(chave: string): string {
    const destino = path.resolve(this.raiz, chave);
    if (!destino.startsWith(this.raiz + path.sep)) {
      throw new Error('Chave de armazenamento inválida');
    }
    return destino;
  }

  async salvar(pasta: 'fotos' | 'termos', extensao: string, conteudo: Buffer) {
    const hoje = new Date();
    const chave = [
      pasta,
      String(hoje.getFullYear()),
      String(hoje.getMonth() + 1).padStart(2, '0'),
      `${randomUUID()}.${extensao}`,
    ].join('/');
    const destino = this.caminho(chave);
    await fs.mkdir(path.dirname(destino), { recursive: true });
    await fs.writeFile(destino, conteudo, { flag: 'wx' });
    return chave;
  }

  ler(chave: string): Promise<Buffer> {
    return fs.readFile(this.caminho(chave));
  }

  async remover(chave: string): Promise<void> {
    await fs.rm(this.caminho(chave), { force: true });
  }
}
