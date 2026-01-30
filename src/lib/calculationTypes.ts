export interface AccountRow {
  номер: number;
  име: string;
  начално_салдо_дебит: number;
  начално_салдо_кредит: number;
  оборот_дебит: number;
  оборот_кредит: number;
  крайно_салдо_дебит: number;
  крайно_салдо_кредит: number;
}

export interface AccountDetail {
  номер: number;
  име: string;
  стойност: number;
}

export interface CalculationResult {
  title?: string;
  period?: string;
  приходи: number;
  разходи: number;
  др_вземания: number;
  др_задължения: number;
  каса: number;
  details: {
    приходи: AccountDetail[];
    разходи: AccountDetail[];
    др_вземания: AccountDetail[];
    др_задължения: AccountDetail[];
    каса: AccountDetail[];
  };
}

export type ExportFormat = 'pdf' | 'xlsx';
