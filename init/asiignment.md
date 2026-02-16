# Concordia University

## Department of Computer Science and Software Engineering

### SOEN 363: Data Systems for Software Engineers – Winter 2026

### Assignment (1)

**Student:** Yassine Ibhir  
**Student ID:** 40251116

---

## Task 1: Making the Database

### Create Students Table

```sql
-- Create Students table
CREATE TABLE Students (
    student_id INT PRIMARY KEY,
    first_name VARCHAR(50) NOT NULL,
    last_name VARCHAR(50) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    age INT,
    enrollment_year INT
);

```

### Create Professors Table

```sql
-- Create Professors table
CREATE TABLE Professors (
professor_id INT PRIMARY KEY,
first_name VARCHAR(50) NOT NULL,
last_name VARCHAR(50) NOT NULL,
email VARCHAR(100) UNIQUE NOT NULL,
department VARCHAR(100) NOT NULL
);

```

### Create Courses Table

```sql
-- Create table
CREATE TABLE Courses (
course_id INT PRIMARY KEY,
course_name VARCHAR(100) NOT NULL,
department VARCHAR(100) NOT NULL,
credits INT CHECK (credits > 0)
);

```

### Create Teachings Table

```sql
-- Create Teachings table
CREATE TABLE Teachings (
    teaching_id INT PRIMARY KEY,
    professor_id INT NOT NULL,
    course_id INT NOT NULL,
    semester VARCHAR(20) NOT NULL,
    year INT NOT NULL,

    CONSTRAINT fk_professor
        FOREIGN KEY (professor_id)
        REFERENCES Professors(professor_id)
        ON DELETE CASCADE,

    CONSTRAINT fk_course
        FOREIGN KEY (course_id)
        REFERENCES Courses(course_id)
        ON DELETE CASCADE
);
```

### Insert Data

```sql
-- Create Enrollments table
CREATE TABLE Enrollments (
    enrollment_id INT PRIMARY KEY,
    student_id INT NOT NULL,
    teaching_id INT NOT NULL,
    grade VARCHAR(10),  -- allows '90', 'DNE', or NULL

    CONSTRAINT fk_student
        FOREIGN KEY (student_id)
        REFERENCES Students(student_id)
        ON DELETE CASCADE,

    CONSTRAINT fk_teaching
        FOREIGN KEY (teaching_id)
        REFERENCES Teachings(teaching_id)
        ON DELETE CASCADE
);
```
