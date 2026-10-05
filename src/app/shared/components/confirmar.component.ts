import { Component, ElementRef, afterRenderEffect, inject, input, model, output, viewChild } from '@angular/core';
import { DOCUMENT } from '@angular/common';

@Component({
  selector: 'app-confirmar',
  imports: [],
  templateUrl: './confirmar.component.html',
  styleUrl: './confirmar.component.scss',
  host: {
    '(document:keydown.escape)': 'cerrar()',
    '(document:keydown.tab)': 'retenerFoco($event)',
    '(document:keydown.shift.tab)': 'retenerFoco($event)',
  },
})
export class ConfirmarComponent {
  private static contador = 0;

  private readonly documento = inject(DOCUMENT);
  private readonly botonCerrar = viewChild<ElementRef<HTMLButtonElement>>('botonCerrar');
  private readonly botonAceptar = viewChild<ElementRef<HTMLButtonElement>>('botonAceptar');
  private focoAnterior: HTMLElement | null = null;

  readonly idTitulo = `confirmar-titulo-${++ConfirmarComponent.contador}`;
  readonly titulo = input<string>('¿Confirmás?');
  readonly texto = input<string>('');
  readonly textoAceptar = input<string>('Confirmar');
  readonly textoCerrar = input<string>('Cancelar');
  readonly abierto = model<boolean>(false);
  readonly confirmado = output<void>();

  constructor() {
    afterRenderEffect(() => {
      const boton = this.botonCerrar()?.nativeElement;

      if (boton) {
        const activo = this.documento.activeElement;
        this.focoAnterior = activo instanceof HTMLElement ? activo : null;
        boton.focus();
        return;
      }

      if (this.focoAnterior?.isConnected) this.focoAnterior.focus();
      this.focoAnterior = null;
    });
  }

  retenerFoco(evento: Event): void {
    const cerrar = this.botonCerrar()?.nativeElement;
    const aceptar = this.botonAceptar()?.nativeElement;
    if (!cerrar || !aceptar) return;

    evento.preventDefault();
    (this.documento.activeElement === cerrar ? aceptar : cerrar).focus();
  }

  cerrar(): void {
    if (this.abierto()) this.abierto.set(false);
  }

  aceptar(): void {
    this.abierto.set(false);
    this.confirmado.emit();
  }
}
