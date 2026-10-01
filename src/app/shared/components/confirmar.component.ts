import { Component, model, input, output } from '@angular/core';

@Component({
  selector: 'app-confirmar',
  imports: [],
  templateUrl: './confirmar.component.html',
  styleUrl: './confirmar.component.scss',
  host: { '(document:keydown.escape)': 'cerrar()' },
})
export class ConfirmarComponent {
  readonly titulo = input<string>('¿Confirmás?');
  readonly texto = input<string>('');
  readonly abierto = model<boolean>(false);
  readonly confirmado = output<void>();

  cerrar(): void {
    if (this.abierto()) this.abierto.set(false);
  }

  aceptar(): void {
    this.abierto.set(false);
    this.confirmado.emit();
  }
}
