import argparse
import csv
import random
from datetime import date, timedelta
from pathlib import Path


SYMBOLS = ["ES", "NQ", "CL", "GC", "EURUSD", "AAPL", "TSLA", "BTCUSD"]
DIRECTIONS = ["LONG", "SHORT"]


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def next_business_day(current: date) -> date:
    current += timedelta(days=1)
    while current.weekday() >= 5:
        current += timedelta(days=1)
    return current


def random_r_multiple() -> float:
    if random.random() < 0.47:
        return clamp(random.gauss(1.15, 0.75), 0.05, 4.5)
    return clamp(random.gauss(-0.85, 0.55), -3.0, -0.05)


def generate_rows(count: int) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    current_date = date(2024, 1, 1)

    for index in range(1, count + 1):
        current_date = next_business_day(current_date)
        symbol = random.choice(SYMBOLS)
        direction = random.choice(DIRECTIONS)
        risk_amount = round(random.uniform(75, 250), 2)
        r_multiple = round(random_r_multiple(), 2)
        pnl = round(risk_amount * r_multiple, 2)
        provide_r_multiple = index % 4 != 0

        rows.append(
            {
                "date": current_date.isoformat(),
                "symbol": symbol,
                "direction": direction,
                "pnl": f"{pnl:.2f}",
                "riskAmount": f"{risk_amount:.2f}",
                "rMultiple": f"{r_multiple:.2f}" if provide_r_multiple else "",
                "note": "provided-r" if provide_r_multiple else "computed-from-pnl-risk",
            }
        )

    return rows


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate sample trade CSV data.")
    parser.add_argument("--rows", type=int, default=1000)
    parser.add_argument("--seed", type=int, default=20260528)
    parser.add_argument("--output", default="samples/sample-trades-1000.csv")
    args = parser.parse_args()

    random.seed(args.seed)
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)

    rows = generate_rows(args.rows)
    with output.open("w", newline="", encoding="utf-8-sig") as csv_file:
        writer = csv.DictWriter(
            csv_file,
            fieldnames=["date", "symbol", "direction", "pnl", "riskAmount", "rMultiple", "note"],
        )
        writer.writeheader()
        writer.writerows(rows)

    print(f"Generated {len(rows)} trades: {output}")


if __name__ == "__main__":
    main()
