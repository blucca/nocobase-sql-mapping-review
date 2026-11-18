-- Fictional, disposable fixture database only. The original business query is supplied separately.
DROP TABLE IF EXISTS invoices, orders, contracts, projects CASCADE;
CREATE TABLE projects (id bigint PRIMARY KEY, code text);
CREATE TABLE contracts (id bigint PRIMARY KEY, name text, "projectID" bigint);
CREATE TABLE orders (id bigint PRIMARY KEY, name text, "contractID" bigint);
CREATE TABLE invoices (
  id bigint PRIMARY KEY,
  name text,
  type text,
  type2 text,
  status text,
  "invoiceDate" timestamptz,
  "paymentDate" timestamptz,
  "invoicePeriodStart" timestamptz,
  "invoicePeriodEnd" timestamptz,
  billable boolean,
  "billableTo" text,
  "incomingInvoiceFrom" text,
  "invoiceNumber" text,
  comment text,
  amount double precision,
  vat double precision,
  "orderID" bigint
);
INSERT INTO projects VALUES (1, 'FIXTURE-PROJECT');
INSERT INTO contracts VALUES (1, 'Fictional contract', 1);
INSERT INTO orders VALUES (1, 'Fictional order', 1);
