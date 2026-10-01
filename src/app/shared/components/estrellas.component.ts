import { Component, computed, input, output, signal } from '@angular/core';

@Component({
  selector: 'app-estrellas',
  imports: [],
  templateUrl: './estrellas.component.html',
  styleUrl: './estrellas.component.scss',
})
export class EstrellasComponent {
  readonly valor = input<number>(0);
  readonly editable = input<boolean>(false);
  readonly tamanio = input<number>(18);
  readonly valorChange = output<number>();

  readonly indices: number[] = [1, 2, 3, 4, 5];

  private readonly previa = signal<number | null>(null);

  private readonly referencia = computed(() => this.previa() ?? this.valor());

  relleno(indice: number): number {
    const porcentaje = (this.referencia() - (indice - 1)) * 100;
    return Math.min(100, Math.max(0, porcentaje));
  }

  previsualizar(indice: number): void {
    if (this.editable()) this.previa.set(indice);
  }

  soltar(): void {
    this.previa.set(null);
  }

  elegir(indice: number): void {
    if (!this.editable()) return;
    this.previa.set(null);
    this.valorChange.emit(indice);
  }
}
